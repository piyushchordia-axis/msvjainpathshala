/**
 * Single homework-submit implementation for the online route and sync/batch.
 * CLAUDE.md offline sync §4 — no parallel offline-only path.
 *
 * Modes:
 *   - upload (default): parent/student provides a submission_url → submitted|late
 *   - markDone: acknowledgement without an artefact → acknowledged (F1)
 */
import {
  db,
  homework_submissions,
  homework_assignments,
  students,
  type User,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { httpUrl } from "../lib/validation";
import { kolkataDateString } from "./attendance-mark";
import { resolveOwnedUpload } from "../lib/owned-upload";
import type { ErrorCode } from "@workspace/api-zod";

export class HomeworkSubmitError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HomeworkSubmitError";
  }
}

const submissionUrlSchema = httpUrl(1000);

function resolveClientWhen(clientTimestamp?: Date | string): Date {
  if (clientTimestamp instanceof Date) return clientTimestamp;
  if (typeof clientTimestamp === "string" && clientTimestamp.length > 0) {
    const d = new Date(clientTimestamp);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

export async function applyHomeworkSubmit(opts: {
  actor: User;
  submissionId: string;
  /** When omitted, an existing submission_url is preserved (never nulled). */
  fileUrl?: string;
  /**
   * Client clock for lateness (AT26). Prefer this over server receipt time so
   * an offline op drained days later is still judged by when the parent acted.
   */
  clientTimestamp?: Date | string;
  /**
   * Parent mark-done without an upload (F1). Sets status='acknowledged'.
   * Mutually exclusive with providing a new fileUrl for the acknowledgement path;
   * upload submit still uses fileUrl as today.
   */
  markDone?: boolean;
}): Promise<{ id: string; status: string; late: boolean }> {
  const [sub] = await db
    .select({
      id: homework_submissions.id,
      student_id: homework_submissions.student_id,
      status: homework_submissions.status,
      submission_url: homework_submissions.submission_url,
      late: homework_submissions.late,
      due_date: homework_assignments.due_date,
      is_msv: homework_assignments.is_msv,
      parent_id: students.parent_id,
      user_id: students.user_id,
      msv_status: students.msv_status,
    })
    .from(homework_submissions)
    .innerJoin(homework_assignments, eq(homework_assignments.id, homework_submissions.assignment_id))
    .innerJoin(students, eq(students.id, homework_submissions.student_id))
    .where(
      and(
        eq(homework_submissions.id, opts.submissionId),
        isNull(homework_assignments.deleted_at),
        isNull(students.deleted_at),
        eq(students.status, "active"),
      ),
    )
    .limit(1);

  if (!sub) {
    throw new HomeworkSubmitError(404, "ERR_NOT_FOUND", "Submission not found.");
  }

  // Parent or the student themself only — no silent super_admin bypass (a
  // national admin submitting a child's homework is odd and was unaudited).
  const owned = sub.parent_id === opts.actor.id || sub.user_id === opts.actor.id;
  if (!owned) {
    throw new HomeworkSubmitError(404, "ERR_NOT_FOUND", "Submission not found.");
  }

  // Catalog/fan-out filtering alone is not enough — submit re-checks MSV
  // audience (same reasoning as niyam-audience.ts).
  if (sub.is_msv && sub.msv_status !== "approved") {
    throw new HomeworkSubmitError(
      403,
      "ERR_FORBIDDEN",
      "This homework is for MSV-approved students only.",
    );
  }

  if (sub.status === "approved" || sub.status === "starred") {
    throw new HomeworkSubmitError(409, "ERR_CONFLICT", "Submission already graded.");
  }

  const when = resolveClientWhen(opts.clientTimestamp);
  const today = kolkataDateString(when);
  const isLate = !!sub.due_date && sub.due_date < today;

  if (opts.markDone) {
    // Idempotent replay: already acknowledged → return current row.
    if (sub.status === "acknowledged") {
      return { id: sub.id, status: sub.status, late: sub.late };
    }
    // Work already uploaded — mark-done is the no-artefact path only.
    if (sub.status === "submitted" || sub.status === "late") {
      throw new HomeworkSubmitError(
        409,
        "ERR_CONFLICT",
        "Work was already uploaded for this homework — no need to mark it done.",
      );
    }

    await db
      .update(homework_submissions)
      .set({
        status: "acknowledged",
        late: isLate,
      })
      .where(eq(homework_submissions.id, sub.id));

    return { id: sub.id, status: "acknowledged", late: isLate };
  }

  let nextUrl: string | undefined;
  if (opts.fileUrl !== undefined) {
    const parsed = submissionUrlSchema.safeParse(opts.fileUrl);
    if (!parsed.success) {
      throw new HomeworkSubmitError(
        422,
        "ERR_VALIDATION_FAILED",
        "That submission link is not a valid http(s) URL — check it and try again.",
      );
    }
    const owned = await resolveOwnedUpload({
      userId: opts.actor.id,
      url: parsed.data,
      folderPrefix: "homework/",
      allowedKinds: ["image", "pdf"],
      label: "homework",
    });
    if (!owned.ok) {
      throw new HomeworkSubmitError(422, "ERR_VALIDATION_FAILED", owned.message);
    }
    nextUrl = parsed.data;
  } else if (!sub.submission_url) {
    throw new HomeworkSubmitError(
      422,
      "ERR_VALIDATION_FAILED",
      "A submission URL is required — upload the work or paste a link first.",
    );
  }

  // AT26: lateness is Asia/Kolkata calendar day vs due_date, using the client's
  // clock when provided (offline drain must not be judged by server receipt).
  const nextStatus = isLate ? ("late" as const) : ("submitted" as const);

  await db
    .update(homework_submissions)
    .set({
      ...(nextUrl !== undefined ? { submission_url: nextUrl } : {}),
      status: nextStatus,
      late: isLate,
    })
    .where(eq(homework_submissions.id, sub.id));

  return { id: sub.id, status: nextStatus, late: isLate };
}
