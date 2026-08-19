/**
 * Shared Niyam approval path — single POST /:id/approve and bulk-approve.
 * Claim pending → awardPunya → gallery → streak → badges (one sequence).
 */
import {
  db,
  niyam_submissions,
  niyam_submission_media,
  niyams,
  students,
  centres,
  gallery_items,
  type User,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import type { AdminScope } from "../lib/scope";
import { inBatchWriteScope } from "../lib/scope";
import { awardPunya } from "../lib/punya";
import { writeAudit } from "../lib/audit";
import { notifyUsers } from "../lib/notify";
import { logger } from "../lib/logger";
import { resolveNiyamAwardPoints } from "../lib/niyam-points";
import { awardNewlyReachedBadges, type AwardedBadge } from "../lib/niyam-badges";
import { uploadKeyFromUrl } from "../lib/file-tokens";
import { MIME_BY_EXT } from "../lib/upload";
import type { NiyamPeriodType } from "../lib/niyam-period";
import type { Role } from "@workspace/api-zod";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** kind === photo is necessary but not sufficient — also require image/* type. */
function mediaLooksLikeImage(m: { url: string; kind: string; mime?: string | null }): boolean {
  const declared = (m.mime ?? "").split(";")[0]!.trim().toLowerCase();
  if (declared.startsWith("image/")) return true;
  const key = uploadKeyFromUrl(m.url);
  if (!key) return false;
  const dot = key.lastIndexOf(".");
  if (dot < 0) return false;
  const fromExt = MIME_BY_EXT[key.slice(dot + 1).toLowerCase()];
  return !!fromExt?.startsWith("image/");
}

/**
 * Photo-only gallery insert. Video EXIF/poster is not available yet —
 * never publish video to the public gallery.
 */
export async function maybeInsertGalleryFromSubmission(
  tx: Tx,
  opts: {
    submissionId: string;
    studentId: string;
    niyamId: string;
    media: Array<{ url: string; kind: string; mime?: string | null }>;
  },
): Promise<void> {
  const photo = opts.media.find((m) => m.kind === "photo" && mediaLooksLikeImage(m));
  if (!photo) return;

  const [centreRow] = await tx
    .select({ city_id: centres.city_id })
    .from(students)
    .innerJoin(centres, eq(centres.id, students.centre_id))
    .where(eq(students.id, opts.studentId))
    .limit(1);

  await tx.insert(gallery_items).values({
    submission_id: opts.submissionId,
    student_id: opts.studentId,
    niyam_id: opts.niyamId,
    city_id: centreRow?.city_id ?? null,
    image_url: photo.url,
    is_public: true,
    featured_gallery: false,
    featured_home: false,
    created_by: null,
  });
}

export type ApproveNiyamOutcome =
  | {
      status: "approved";
      submissionId: string;
      awardPoints: number;
      total_points: number;
      tier: string;
      newBadges: AwardedBadge[];
      parent_id: string | null;
      student_name: string;
      created_at: Date;
      niyam_id: string;
      student_id: string;
      submission_date: string;
    }
  | { status: "not_found" }
  | { status: "not_pending"; submissionId: string };

/**
 * Approve one pending submission. Scope-checked; claim is status='pending'.
 * Writes the per-submission audit on success.
 */
export async function approveNiyamSubmission(opts: {
  submissionId: string;
  actor: User;
  scope: AdminScope;
  /** Optional IP for audit (bulk / single). */
  ip?: string | null;
}): Promise<ApproveNiyamOutcome> {
  const [sub] = await db
    .select({
      id: niyam_submissions.id,
      status: niyam_submissions.status,
      student_id: niyam_submissions.student_id,
      niyam_id: niyam_submissions.niyam_id,
      submission_date: niyam_submissions.submission_date,
      period_key: niyam_submissions.period_key,
      notes: niyam_submissions.notes,
      created_at: niyam_submissions.created_at,
      centre_id: students.centre_id,
      batch_id: students.batch_id,
      parent_id: students.parent_id,
      /** Set when the child has their own OTP login (Q4, age 8+). */
      student_user_id: students.user_id,
      student_name: students.full_name,
      city_id: centres.city_id,
      points: niyams.points,
      niyam_type: niyams.niyam_type,
      // For the bilingual approval push below.
      niyam_title_en: niyams.title_en,
      niyam_title_hi: niyams.title_hi,
    })
    .from(niyam_submissions)
    .innerJoin(students, eq(students.id, niyam_submissions.student_id))
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .innerJoin(niyams, eq(niyams.id, niyam_submissions.niyam_id))
    .where(eq(niyam_submissions.id, opts.submissionId))
    .limit(1);

  // Q12 — shikshak is batch-bound; sanchalak+ keep centre reach via batchIds === null.
  if (!sub || !inBatchWriteScope(opts.scope, sub.batch_id, sub.centre_id)) {
    return { status: "not_found" };
  }

  const awardPoints = await resolveNiyamAwardPoints(sub.points, sub.city_id);

  // Lazy import avoids a circular init with the route module that re-exports streak helpers.
  const { recomputeStreak } = await import("../routes/v1/niyam-submissions");

  const award = await db.transaction(async (tx) => {
    const now = new Date();
    const updated = await tx
      .update(niyam_submissions)
      .set({
        status: "approved",
        points_awarded: awardPoints,
        reviewed_by: opts.actor.id,
        reviewed_at: now,
        approved_at: now,
      })
      .where(and(eq(niyam_submissions.id, sub.id), eq(niyam_submissions.status, "pending")))
      .returning({ id: niyam_submissions.id });
    if (updated.length === 0) return null;

    const result = await awardPunya(
      {
        studentId: sub.student_id,
        featureKey: "niyam_submission",
        points: awardPoints,
        note: sub.notes ?? null,
        awardedBy: opts.actor.id,
        idempotencyKey: `submission:${sub.id}`,
      },
      tx,
    );

    if (result.transaction_id) {
      await tx
        .update(niyam_submissions)
        .set({ punya_transaction_id: result.transaction_id })
        .where(eq(niyam_submissions.id, sub.id));
    }

    const mediaRows = await tx
      .select({
        url: niyam_submission_media.url,
        kind: niyam_submission_media.kind,
        mime: niyam_submission_media.mime,
      })
      .from(niyam_submission_media)
      .where(eq(niyam_submission_media.submission_id, sub.id))
      .orderBy(asc(niyam_submission_media.ordinal));
    await maybeInsertGalleryFromSubmission(tx, {
      submissionId: sub.id,
      studentId: sub.student_id,
      niyamId: sub.niyam_id,
      media: mediaRows,
    });

    const streak = await recomputeStreak(
      sub.student_id,
      sub.niyam_id,
      sub.niyam_type as NiyamPeriodType,
      tx,
    );
    const newBadges = await awardNewlyReachedBadges(
      {
        studentId: sub.student_id,
        niyamId: sub.niyam_id,
        niyamType: sub.niyam_type as NiyamPeriodType,
        currentStreak: streak.current,
        awardedBy: opts.actor.id,
        cityId: sub.city_id,
      },
      tx,
    );

    return { result, newBadges };
  });

  if (!award) {
    return { status: "not_pending", submissionId: sub.id };
  }

  await writeAudit({
    actorId: opts.actor.id,
    actorRole: opts.actor.role as Role,
    action: "approve",
    entityKind: "niyam_submission",
    entityId: sub.id,
    summary: `Approved niyam submission (+${awardPoints}).`,
    metadata: {
      niyam_id: sub.niyam_id,
      student_id: sub.student_id,
      points: awardPoints,
      submission_date: sub.submission_date,
    },
    ip: opts.ip ?? null,
  });

  // Post-commit, best-effort — an approval must never fail on notify. Lives
  // here rather than in the routes so single AND bulk approve both send it;
  // only rejection and badges were ever notified, so a child whose niyam was
  // approved by their Guruji heard nothing at all.
  // Parent AND the child's own login when they have one: a student aged 8+ on
  // their own OTP account (Q4) is the person who kept the niyam, and a
  // parent_id-only send left exactly that child hearing nothing. notifyUsers
  // honours each recipient's notification_preferences independently.
  const approvalRecipients = [...new Set([sub.parent_id, sub.student_user_id])].filter(
    (id): id is string => !!id,
  );
  if (approvalRecipients.length > 0) {
    await notifyUsers({
      userIds: approvalRecipients,
      kind: "niyam_approved",
      title_en: "Niyam approved",
      title_hi: "नियम स्वीकृत",
      body_en: `${sub.student_name}'s "${sub.niyam_title_en}" was approved — +${awardPoints} Punya.`,
      body_hi: `${sub.student_name} का "${sub.niyam_title_hi ?? sub.niyam_title_en}" स्वीकृत — +${awardPoints} पुण्य।`,
      push: true,
      data: { kind: "niyam_approved", submission_id: sub.id },
    }).catch((err) => {
      logger.warn({ err, submissionId: sub.id }, "niyam approval notify failed");
    });
  }

  return {
    status: "approved",
    submissionId: sub.id,
    awardPoints,
    total_points: award.result.total_points,
    tier: award.result.tier,
    newBadges: award.newBadges,
    parent_id: sub.parent_id,
    student_name: sub.student_name,
    created_at: sub.created_at,
    niyam_id: sub.niyam_id,
    student_id: sub.student_id,
    submission_date: sub.submission_date,
  };
}
