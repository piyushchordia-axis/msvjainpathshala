import {
  db,
  homework_submissions,
  homework_assignments,
  type User,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { students } from "@workspace/db";

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

export async function applyHomeworkSubmit(opts: {
  actor: User;
  submissionId: string;
  fileUrl?: string;
  notes?: string;
}): Promise<{ id: string; status: string }> {
  const [sub] = await db
    .select({
      id: homework_submissions.id,
      student_id: homework_submissions.student_id,
      status: homework_submissions.status,
      due_date: homework_assignments.due_date,
      parent_id: students.parent_id,
      user_id: students.user_id,
    })
    .from(homework_submissions)
    .innerJoin(homework_assignments, eq(homework_assignments.id, homework_submissions.assignment_id))
    .innerJoin(students, eq(students.id, homework_submissions.student_id))
    .where(and(eq(homework_submissions.id, opts.submissionId), isNull(homework_assignments.deleted_at)))
    .limit(1);

  if (!sub) {
    throw new HomeworkSubmitError(404, "ERR_NOT_FOUND", "Submission not found.");
  }
  const owned =
    opts.actor.role === "super_admin" ||
    sub.parent_id === opts.actor.id ||
    sub.user_id === opts.actor.id;
  if (!owned) {
    throw new HomeworkSubmitError(404, "ERR_NOT_FOUND", "Submission not found.");
  }
  if (sub.status === "approved" || sub.status === "starred") {
    throw new HomeworkSubmitError(409, "ERR_CONFLICT", "Submission already graded.");
  }

  const today = new Date().toISOString().slice(0, 10);
  const isLate = !!sub.due_date && sub.due_date < today;
  const nextStatus = isLate ? "late" : "submitted";

  await db
    .update(homework_submissions)
    .set({
      submission_url: opts.fileUrl ?? null,
      status: nextStatus,
      late: isLate,
    })
    .where(eq(homework_submissions.id, sub.id));

  return { id: sub.id, status: nextStatus };
}
