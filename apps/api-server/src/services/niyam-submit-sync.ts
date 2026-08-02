/**
 * Thin sync wrapper around niyam submission create.
 */
import { db, niyams, niyam_submissions, students, centres, type User } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { studentCanAccessNiyam } from "../lib/niyam-audience";
import { periodKey, istCalendarDate } from "../lib/niyam-period";

export class NiyamSubmitError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
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
  proofAssetId?: string;
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

  const submissionDate = istCalendarDate(new Date());
  const pKey = periodKey(
    niyam.niyam_type as "daily" | "weekly" | "monthly",
    submissionDate,
  );
  const status = niyam.approval_mode === "auto" ? "auto_approved" : "pending";

  const [row] = await db
    .insert(niyam_submissions)
    .values({
      niyam_id: opts.niyamId,
      student_id: opts.studentId,
      submission_date: submissionDate,
      period_key: pKey,
      status,
      notes: opts.notes ?? null,
      proof_url: opts.proofAssetId ?? null,
      submitted_by: opts.actor.id,
    })
    .returning({ id: niyam_submissions.id });

  return { id: row!.id };
}
