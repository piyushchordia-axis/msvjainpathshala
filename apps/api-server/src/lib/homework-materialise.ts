/**
 * When a student joins a batch, materialise pending submissions for that batch's
 * not-yet-due homework (FIX #14 option b). Fan-out rows are the source of truth;
 * target_student_ids was dropped as write-only drift.
 */
import { db, homework_assignments, homework_submissions, students } from "@workspace/db";
import { and, eq, gte, isNull } from "drizzle-orm";
import { kolkataDateString } from "../services/attendance-mark";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

/** Insert missing homework_submissions for open (due today or later) assignments. */
export async function materialiseHomeworkOnBatchJoin(
  studentId: string,
  batchId: string,
  exec: DbOrTx = db,
): Promise<number> {
  const [stu] = await exec
    .select({
      id: students.id,
      msv_status: students.msv_status,
      status: students.status,
      deleted_at: students.deleted_at,
    })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  if (!stu || stu.deleted_at || stu.status !== "active") return 0;

  const today = kolkataDateString(new Date());

  const open = await exec
    .select({
      id: homework_assignments.id,
      is_msv: homework_assignments.is_msv,
    })
    .from(homework_assignments)
    .where(
      and(
        eq(homework_assignments.batch_id, batchId),
        isNull(homework_assignments.deleted_at),
        // Not-yet-due in Asia/Kolkata — past-due are NOT back-created for late joiners.
        gte(homework_assignments.due_date, today),
      ),
    );

  const eligible = open.filter((a) => !a.is_msv || stu.msv_status === "approved");
  if (eligible.length === 0) return 0;

  const inserted = await exec
    .insert(homework_submissions)
    .values(
      eligible.map((a) => ({
        assignment_id: a.id,
        student_id: studentId,
        status: "pending" as const,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: homework_submissions.id });

  return inserted.length;
}

export async function materialiseHomeworkForStudentBatch(
  studentId: string,
  batchId: string | null | undefined,
  exec: DbOrTx = db,
): Promise<number> {
  if (!batchId) return 0;
  return materialiseHomeworkOnBatchJoin(studentId, batchId, exec);
}
