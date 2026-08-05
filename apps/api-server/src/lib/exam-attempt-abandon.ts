/**
 * Mark in_progress attempts abandoned once window_end + 2 hours has passed
 * (mirrors AT12 stale auto-checkout grace).
 */
import { db, exam_attempts, online_exams } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { logger } from "./logger";

export async function runExamAttemptAbandon(): Promise<{ abandoned: number }> {
  const stale = await db
    .select({ id: exam_attempts.id })
    .from(exam_attempts)
    .innerJoin(online_exams, eq(online_exams.id, exam_attempts.exam_id))
    .where(
      and(
        eq(exam_attempts.status, "in_progress"),
        sql`${online_exams.window_end} + interval '2 hours' < now()`,
      ),
    );

  if (stale.length === 0) return { abandoned: 0 };

  const ids = stale.map((r) => r.id);
  await db
    .update(exam_attempts)
    .set({ status: "abandoned", updated_at: new Date() })
    .where(inArray(exam_attempts.id, ids));

  logger.info({ abandoned: ids.length }, "Abandoned stale exam attempts");
  return { abandoned: ids.length };
}
