/**
 * Single homework-submit implementation for the online route and sync/batch.
 * CLAUDE.md offline sync §4 — no parallel offline-only path.
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

export class HomeworkSubmitError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HomeworkSubmitError";
  }
}

const submissionUrlSchema = httpUrl(1000);

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
}): Promise<{ id: string; status: string; late: boolean }> {
  const [sub] = await db
    .select({
      id: homework_submissions.id,
      student_id: homework_submissions.student_id,
      status: homework_submissions.status,
      submission_url: homework_submissions.submission_url,
      due_date: homework_assignments.due_date,
      parent_id: students.parent_id,
      user_id: students.user_id,
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

  if (sub.status === "approved" || sub.status === "starred") {
    throw new HomeworkSubmitError(409, "ERR_CONFLICT", "Submission already graded.");
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
  const when =
    opts.clientTimestamp instanceof Date
      ? opts.clientTimestamp
      : typeof opts.clientTimestamp === "string" && opts.clientTimestamp.length > 0
        ? new Date(opts.clientTimestamp)
        : new Date();
  const today = kolkataDateString(Number.isNaN(when.getTime()) ? new Date() : when);
  const isLate = !!sub.due_date && sub.due_date < today;
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
