/**
 * Shared Niyam submission path — POST /v1/niyam-submissions AND the
 * `niyam_submission` op of POST /v1/sync/batch.
 *
 * CLAUDE.md "Offline sync §4" requires each sync op_type handler to call the
 * SAME service method as its direct online endpoint. This file exists because
 * that rule was broken: `services/niyam-submit-sync.ts` was a second, weaker
 * implementation that inserted the submission row and awarded NOTHING — no
 * Punya, no points_awarded, no streak, no badge, no gallery. Once the mobile
 * client moved onto the offline queue (jp.queue.niyam_submissions) every real
 * submission went through that path, so children were told their niyam was
 * approved and received zero Punya. Both callers now land here.
 *
 * Rate limiting deliberately stays on the HTTP route and is NOT applied here.
 * A parent syncing a week of offline niyams would trip the 20/hour per-student
 * bucket; a 429 is retryable but the backoff caps at 5 min / 10 attempts and
 * would never outlast an hour-long window, so the marks would be lost. Replay
 * safety for the sync path comes from `sync_operations` plus the period unique
 * index, not from the abuse guard on the online entry point.
 */
import {
  db,
  niyams,
  niyam_submissions,
  niyam_submission_media,
  students,
  centres,
} from "@workspace/db";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { ErrorCode, Role } from "@workspace/api-zod";
import { awardPunya } from "../lib/punya";
import { writeAudit } from "../lib/audit";
import { ownedStudentsCondition } from "../lib/route-helpers";
import { studentCanAccessNiyam } from "../lib/niyam-audience";
import { resolveNiyamAwardPoints } from "../lib/niyam-points";
import {
  awardNewlyReachedBadges,
  notifyBadgesPush,
  type AwardedBadge,
} from "../lib/niyam-badges";
import {
  resolveSubmissionMedia,
  checkMediaAgainstNiyam,
  type ClientMediaItem,
  type ResolvedMediaItem,
} from "../lib/niyam-media";
import {
  allowedMediaKinds,
  addCalendarDays,
  istCalendarDate,
  periodKey,
  SUBMISSION_BACKDATE_DAYS,
  type NiyamPeriodType,
} from "../lib/niyam-period";
import { maybeInsertGalleryFromSubmission } from "./niyam-approve";

/** Same shape as AttendanceMarkError / SessionLifecycleError — sync-batch maps 409 to `conflict`. */
export class NiyamSubmitError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NiyamSubmitError";
  }
}

export interface SubmitNiyamInput {
  actorUserId: string;
  actorRole: Role;
  /** Audit only; null from the sync path. */
  actorIp?: string | null;
  /** Audit only — preserves impersonation attribution when the route delegates here. */
  impersonatorId?: string | null;
  niyamId: string;
  studentId: string;
  /** YYYY-MM-DD (IST). Defaults to today; today or yesterday only. */
  submissionDate?: string;
  media?: ClientMediaItem[];
  /** @deprecated single-proof wire form — treated as media[0]. */
  proofUrl?: string;
  notes?: string;
}

export interface SubmitNiyamOutcome {
  row: typeof niyam_submissions.$inferSelect;
  newBadges: AwardedBadge[];
  media: Array<typeof niyam_submission_media.$inferSelect>;
  awardPoints: number;
  autoApproved: boolean;
}

/** Earliest submission_date allowed relative to today (IST). */
function earliestAllowedSubmissionDate(today: string): string {
  return addCalendarDays(today, -SUBMISSION_BACKDATE_DAYS);
}

export async function submitNiyam(input: SubmitNiyamInput): Promise<SubmitNiyamOutcome> {
  // Ownership and context in one read. `ownedStudentsCondition` is the SAME
  // rule the online endpoint enforces: parent-of, or is, that student — and it
  // excludes soft-deleted and inactive students (Q11). No staff role can submit
  // a niyam on a child's behalf on either path; the offline handler used to
  // admit four staff roles nationwide, which was a capability the HTTP endpoint
  // never had.
  const [studentCtx] = await db
    .select({
      id: students.id,
      msv_status: students.msv_status,
      parent_id: students.parent_id,
      full_name: students.full_name,
      city_id: centres.city_id,
      state_id: centres.state_id,
    })
    .from(students)
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .where(and(eq(students.id, input.studentId), ownedStudentsCondition(input.actorUserId)))
    .limit(1);
  if (!studentCtx) {
    throw new NiyamSubmitError(404, "ERR_NOT_FOUND", "Student not found.");
  }

  const [niyam] = await db
    .select({
      id: niyams.id,
      proof_type: niyams.proof_type,
      proof_required: niyams.proof_required,
      approval_mode: niyams.approval_mode,
      max_uploads: niyams.max_uploads,
      niyam_type: niyams.niyam_type,
      points: niyams.points,
      start_date: niyams.start_date,
      end_date: niyams.end_date,
      msv_audience: niyams.msv_audience,
      scope: niyams.scope,
      state_id: niyams.state_id,
      city_id: niyams.city_id,
    })
    .from(niyams)
    .where(and(eq(niyams.id, input.niyamId), eq(niyams.is_active, true)))
    .limit(1);
  if (!niyam) {
    throw new NiyamSubmitError(404, "ERR_NOT_FOUND", "Niyam not found.");
  }

  if (
    !studentCanAccessNiyam(
      {
        msv_audience: niyam.msv_audience,
        scope: niyam.scope,
        state_id: niyam.state_id,
        city_id: niyam.city_id,
      },
      {
        msv_status: studentCtx.msv_status,
        city_id: studentCtx.city_id,
        state_id: studentCtx.state_id,
      },
    )
  ) {
    throw new NiyamSubmitError(
      403,
      "ERR_FORBIDDEN",
      "This niyam is not available for this student.",
    );
  }

  const today = istCalendarDate();
  const submissionDate = input.submissionDate ?? today;
  if (submissionDate > today) {
    throw new NiyamSubmitError(
      422,
      "ERR_VALIDATION_FAILED",
      "submission_date cannot be in the future.",
    );
  }
  if (submissionDate < earliestAllowedSubmissionDate(today)) {
    throw new NiyamSubmitError(422, "ERR_VALIDATION_FAILED", "submission_date too old.");
  }
  // Spec §8.4 step 6 — compare submission_date to the niyam window, not now().
  if (niyam.start_date && submissionDate < niyam.start_date) {
    throw new NiyamSubmitError(
      422,
      "ERR_VALIDATION_FAILED",
      "submission_date is before this niyam starts.",
    );
  }
  if (niyam.end_date && submissionDate > niyam.end_date) {
    throw new NiyamSubmitError(
      422,
      "ERR_VALIDATION_FAILED",
      "submission_date is after this niyam ended.",
    );
  }

  let media = input.media ?? [];
  if (media.length === 0 && input.proofUrl) {
    // kind is a wire placeholder — resolveSubmissionMedia derives the real kind.
    media = [{ url: input.proofUrl, kind: "photo" }];
  }

  const mediaGate = checkMediaAgainstNiyam(
    { max_uploads: niyam.max_uploads, proof_required: niyam.proof_required },
    media.length,
  );
  if (!mediaGate.ok) {
    throw new NiyamSubmitError(422, "ERR_VALIDATION_FAILED", mediaGate.message);
  }

  const resolved = await resolveSubmissionMedia(
    input.actorUserId,
    media,
    allowedMediaKinds(niyam.proof_type),
  );
  if (!resolved.ok) {
    throw new NiyamSubmitError(422, "ERR_VALIDATION_FAILED", resolved.message);
  }
  const verifiedMedia: ResolvedMediaItem[] = resolved.items;

  const pKey = periodKey(niyam.niyam_type as NiyamPeriodType, submissionDate);
  const autoApprove = niyam.approval_mode === "auto";
  const awardPoints = autoApprove
    ? await resolveNiyamAwardPoints(niyam.points, studentCtx.city_id)
    : 0;
  const status = autoApprove ? "auto_approved" : "pending";
  const firstUrl = verifiedMedia[0]?.url ?? null;

  // Lazy import avoids a circular init with the route module that owns the
  // streak helpers — same pattern as services/niyam-approve.ts.
  const { recomputeStreak } = await import("../routes/v1/niyam-submissions");

  const lockKey = `niyam:${niyam.id}:${input.studentId}:${pKey}`;
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const [dup] = await tx
      .select({ id: niyam_submissions.id })
      .from(niyam_submissions)
      .where(
        and(
          eq(niyam_submissions.niyam_id, niyam.id),
          eq(niyam_submissions.student_id, input.studentId),
          eq(niyam_submissions.period_key, pKey),
          ne(niyam_submissions.status, "rejected"),
        ),
      )
      .limit(1);
    if (dup) return null;

    const [created] = await tx
      .insert(niyam_submissions)
      .values({
        niyam_id: niyam.id,
        student_id: input.studentId,
        submission_date: submissionDate,
        period_key: pKey,
        status,
        points_awarded: autoApprove ? awardPoints : 0,
        proof_url: firstUrl,
        notes: input.notes ?? null,
        submitted_by: input.actorUserId,
      })
      .returning();
    if (verifiedMedia.length > 0) {
      await tx.insert(niyam_submission_media).values(
        verifiedMedia.map((m, i) => ({
          submission_id: created!.id,
          url: m.url,
          kind: m.kind,
          mime: m.mime ?? null,
          size_bytes: m.size_bytes ?? null,
          ordinal: i,
        })),
      );
    }

    let row = created!;
    let newBadges: AwardedBadge[] = [];

    if (autoApprove) {
      const award = await awardPunya(
        {
          studentId: input.studentId,
          featureKey: "niyam_submission",
          points: awardPoints,
          note: input.notes ?? null,
          awardedBy: input.actorUserId,
          idempotencyKey: `submission:${created!.id}`,
        },
        tx,
      );
      const now = new Date();
      const [updated] = await tx
        .update(niyam_submissions)
        .set({ approved_at: now, punya_transaction_id: award.transaction_id })
        .where(eq(niyam_submissions.id, created!.id))
        .returning();
      row = updated ?? created!;

      await maybeInsertGalleryFromSubmission(tx, {
        submissionId: created!.id,
        studentId: input.studentId,
        niyamId: niyam.id,
        media: verifiedMedia,
      });

      const streak = await recomputeStreak(
        input.studentId,
        niyam.id,
        niyam.niyam_type as NiyamPeriodType,
        tx,
      );
      newBadges = await awardNewlyReachedBadges(
        {
          studentId: input.studentId,
          niyamId: niyam.id,
          niyamType: niyam.niyam_type as NiyamPeriodType,
          currentStreak: streak.current,
          awardedBy: input.actorUserId,
          cityId: studentCtx.city_id,
        },
        tx,
      );
    }

    return { row, newBadges };
  });

  if (!outcome) {
    throw new NiyamSubmitError(
      409,
      "ERR_NIYAM_PERIOD_DUPLICATE",
      `Already submitted for this ${niyam.niyam_type} period (${pKey}).`,
    );
  }

  const { row, newBadges } = outcome;

  // Audit and push strictly post-commit — never fail the submission.
  if (autoApprove) {
    await writeAudit({
      actorId: input.actorUserId,
      actorRole: input.actorRole,
      action: "award",
      entityKind: "niyam_submission",
      entityId: row.id,
      summary: `Auto-approved niyam submission (+${awardPoints}).`,
      metadata: {
        niyam_id: niyam.id,
        student_id: input.studentId,
        points: awardPoints,
        submission_date: submissionDate,
        period_key: pKey,
        ...(input.impersonatorId ? { impersonator_id: input.impersonatorId } : {}),
      },
      ip: input.actorIp ?? null,
    });
    await notifyBadgesPush({
      parentUserId: studentCtx.parent_id,
      studentName: studentCtx.full_name,
      badges: newBadges,
    });
  }

  const mediaRows = await db
    .select()
    .from(niyam_submission_media)
    .where(eq(niyam_submission_media.submission_id, row.id))
    .orderBy(asc(niyam_submission_media.ordinal));

  return { row, newBadges, media: mediaRows, awardPoints, autoApproved: autoApprove };
}
