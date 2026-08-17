/**
 * Thin sync wrapper around niyam submission create.
 */
import type { ErrorCode } from "@workspace/api-zod";
import {
  db,
  niyams,
  niyam_submissions,
  niyam_submission_media,
  students,
  centres,
  type User,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { studentCanAccessNiyam } from "../lib/niyam-audience";
import { periodKey, istCalendarDate, allowedMediaKinds } from "../lib/niyam-period";
import {
  resolveSubmissionMedia,
  checkMediaAgainstNiyam,
  type ClientMediaItem,
  type ProofMediaKind,
} from "../lib/niyam-media";

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

export async function applyNiyamSubmission(opts: {
  actor: User;
  niyamId: string;
  studentId: string;
  /** @deprecated single-proof wire form — prefer `media`. Treated as media[0]. */
  proofAssetId?: string;
  media?: ClientMediaItem[];
  notes?: string;
}): Promise<{ id: string }> {
  const [studentCtx] = await db
    .select({
      id: students.id,
      msv_status: students.msv_status,
      parent_id: students.parent_id,
      user_id: students.user_id,
      city_id: centres.city_id,
      state_id: centres.state_id,
    })
    .from(students)
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .where(eq(students.id, opts.studentId))
    .limit(1);

  if (!studentCtx) {
    throw new NiyamSubmitError(404, "ERR_NOT_FOUND", "Student not found.");
  }
  const owned =
    opts.actor.role === "super_admin" ||
    studentCtx.parent_id === opts.actor.id ||
    studentCtx.user_id === opts.actor.id ||
    ["shikshak", "sanchalak", "city_admin", "state_admin"].includes(opts.actor.role);
  if (!owned) {
    throw new NiyamSubmitError(404, "ERR_NOT_FOUND", "Student not found.");
  }

  const [niyam] = await db
    .select()
    .from(niyams)
    .where(and(eq(niyams.id, opts.niyamId), eq(niyams.is_active, true)))
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
    throw new NiyamSubmitError(403, "ERR_FORBIDDEN", "This niyam is not available for this student.");
  }

  // Media is validated and ownership-resolved with the SAME helpers as the online
  // route (CLAUDE.md offline sync §4). Previously this path took an unvalidated
  // single `proof_asset_id`, so an offline submission could land without the proof
  // its niyam required, or with a URL the submitter did not own.
  const clientMedia: ClientMediaItem[] =
    opts.media && opts.media.length > 0
      ? opts.media
      : opts.proofAssetId
        ? [{ url: opts.proofAssetId, kind: "photo" as ProofMediaKind }]
        : [];

  const mediaGate = checkMediaAgainstNiyam(
    { max_uploads: niyam.max_uploads, proof_required: niyam.proof_required },
    clientMedia.length,
  );
  if (!mediaGate.ok) {
    throw new NiyamSubmitError(422, "ERR_VALIDATION_FAILED", mediaGate.message);
  }

  const resolvedMedia = clientMedia.length
    ? await resolveSubmissionMedia(opts.actor.id, clientMedia, allowedMediaKinds(niyam.proof_type))
    : ({ ok: true, items: [] } as const);
  if (!resolvedMedia.ok) {
    throw new NiyamSubmitError(422, "ERR_VALIDATION_FAILED", resolvedMedia.message);
  }

  const submissionDate = istCalendarDate(new Date());
  const pKey = periodKey(
    niyam.niyam_type as "daily" | "weekly" | "monthly",
    submissionDate,
  );
  const status = niyam.approval_mode === "auto" ? "auto_approved" : "pending";

  // Submission + its media commit together: a proof-required niyam must never
  // end up with a row whose proofs failed to insert.
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(niyam_submissions)
      .values({
        niyam_id: opts.niyamId,
        student_id: opts.studentId,
        submission_date: submissionDate,
        period_key: pKey,
        status,
        notes: opts.notes ?? null,
        // Legacy single-proof column — keep the first resolved item for readers
        // that have not moved to niyam_submission_media yet.
        proof_url: resolvedMedia.items[0]?.url ?? null,
        submitted_by: opts.actor.id,
      })
      .returning({ id: niyam_submissions.id });

    if (resolvedMedia.items.length > 0) {
      await tx.insert(niyam_submission_media).values(
        resolvedMedia.items.map((m, i) => ({
          submission_id: row!.id,
          url: m.url,
          kind: m.kind,
          mime: m.mime,
          size_bytes: m.size_bytes,
          ordinal: i,
        })),
      );
    }
    return row!.id;
  });

  return { id };
}
