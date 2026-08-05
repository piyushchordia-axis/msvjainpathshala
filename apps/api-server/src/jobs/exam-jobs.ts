/**
 * Registers BullMQ handlers + cron enqueuers for exam attempt abandon and
 * top-score Punya (frozen cron table). Kept out of the route module so
 * importing the exams router does not start scheduled work (N6).
 */
import { QUEUE_NAMES, CRON_EXPRESSIONS } from "@jp/shared/constants";
import {
  registerQueueHandler,
  enqueueJob,
  dailyCronJobId,
  slotCronJobId,
} from "../lib/queues";
import { registerCron } from "../lib/scheduler";
import { runExamAttemptAbandon } from "../lib/exam-attempt-abandon";
import { runExamTopScoreAwards } from "../lib/exam-punya";
import { todayIst } from "../services/session-materialise";

let registered = false;

export function registerExamJobs(): void {
  if (registered) return;
  registered = true;

  registerQueueHandler(QUEUE_NAMES.EXAM_ATTEMPT_ABANDON, async () => {
    await runExamAttemptAbandon();
  });

  registerCron(QUEUE_NAMES.EXAM_ATTEMPT_ABANDON, CRON_EXPRESSIONS.EXAM_ATTEMPT_ABANDON, async () => {
    await enqueueJob(
      QUEUE_NAMES.EXAM_ATTEMPT_ABANDON,
      {},
      { jobId: slotCronJobId("exam_abandon", 30) },
    );
  });

  registerQueueHandler(QUEUE_NAMES.EXAM_TOP_SCORE, async (data) => {
    const examId = typeof data.exam_id === "string" ? data.exam_id : undefined;
    await runExamTopScoreAwards(examId);
  });

  registerCron(QUEUE_NAMES.EXAM_TOP_SCORE, CRON_EXPRESSIONS.EXAM_TOP_SCORE, async () => {
    await enqueueJob(
      QUEUE_NAMES.EXAM_TOP_SCORE,
      {},
      { jobId: dailyCronJobId("exam_top_score", todayIst()) },
    );
  });
}
