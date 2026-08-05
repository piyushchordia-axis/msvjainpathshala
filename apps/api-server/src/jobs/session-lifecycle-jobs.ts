/**
 * Registers BullMQ handlers + cron enqueuers for session materialise,
 * auto-checkout, and no-show (frozen cron table).
 */
import { QUEUE_NAMES, CRON_EXPRESSIONS } from "@jp/shared/constants";
import {
  registerQueueHandler,
  enqueueJob,
  dailyCronJobId,
  slotCronJobId,
} from "../lib/queues";
import { registerCron } from "../lib/scheduler";
import { materialiseAllActiveBatches, todayIst } from "../services/session-materialise";
import {
  autoCheckoutStaleSessions,
  flagNoShowSessions,
} from "../services/session-lifecycle";

let registered = false;

export function registerSessionLifecycleJobs(): void {
  if (registered) return;
  registered = true;

  registerQueueHandler(QUEUE_NAMES.SESSION_MATERIALISE, async () => {
    await materialiseAllActiveBatches();
  });

  registerQueueHandler(QUEUE_NAMES.ATTENDANCE_AUTO_CHECKOUT, async () => {
    await autoCheckoutStaleSessions();
  });

  registerQueueHandler(QUEUE_NAMES.ATTENDANCE_NO_SHOW_CHECK, async () => {
    await flagNoShowSessions();
  });

  // PARENT_NOTIFY handler lives in derived-data-jobs (attendance debounce + misc).

  // Cron → enqueue (or inline when Redis absent). Deterministic jobIds (PERF #16).
  registerCron(QUEUE_NAMES.SESSION_MATERIALISE, CRON_EXPRESSIONS.SESSION_MATERIALISE, async () => {
    await enqueueJob(
      QUEUE_NAMES.SESSION_MATERIALISE,
      {},
      { jobId: dailyCronJobId("materialise", todayIst()) },
    );
  });

  registerCron(
    QUEUE_NAMES.ATTENDANCE_NO_SHOW_CHECK,
    CRON_EXPRESSIONS.ATTENDANCE_NO_SHOW_CHECK,
    async () => {
      await enqueueJob(
        QUEUE_NAMES.ATTENDANCE_NO_SHOW_CHECK,
        {},
        { jobId: slotCronJobId("no_show", 15) },
      );
    },
  );

  registerCron(
    QUEUE_NAMES.ATTENDANCE_AUTO_CHECKOUT,
    CRON_EXPRESSIONS.ATTENDANCE_AUTO_CHECKOUT,
    async () => {
      await enqueueJob(
        QUEUE_NAMES.ATTENDANCE_AUTO_CHECKOUT,
        {},
        { jobId: slotCronJobId("auto_checkout", 30) },
      );
    },
  );
}
