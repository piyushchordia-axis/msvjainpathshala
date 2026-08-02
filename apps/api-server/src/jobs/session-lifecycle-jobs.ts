/**
 * Registers BullMQ handlers + cron enqueuers for session materialise,
 * auto-checkout, and no-show (frozen cron table).
 */
import { QUEUE_NAMES, CRON_EXPRESSIONS } from "@jp/shared/constants";
import { registerQueueHandler, enqueueJob } from "../lib/queues";
import { registerCron } from "../lib/scheduler";
import { materialiseAllActiveBatches } from "../services/session-materialise";
import {
  autoCheckoutStaleSessions,
  flagNoShowSessions,
} from "../services/session-lifecycle";
import { logger } from "../lib/logger";

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

  registerQueueHandler(QUEUE_NAMES.PARENT_NOTIFY, async (data) => {
    logger.debug({ data }, "parent notify job (inline no-op; push already sent)");
  });

  // Cron → enqueue (or inline when Redis absent).
  registerCron(QUEUE_NAMES.SESSION_MATERIALISE, CRON_EXPRESSIONS.SESSION_MATERIALISE, async () => {
    await enqueueJob(QUEUE_NAMES.SESSION_MATERIALISE, {});
  });

  registerCron(
    QUEUE_NAMES.ATTENDANCE_NO_SHOW_CHECK,
    CRON_EXPRESSIONS.ATTENDANCE_NO_SHOW_CHECK,
    async () => {
      await enqueueJob(QUEUE_NAMES.ATTENDANCE_NO_SHOW_CHECK, {});
    },
  );

  registerCron(
    QUEUE_NAMES.ATTENDANCE_AUTO_CHECKOUT,
    CRON_EXPRESSIONS.ATTENDANCE_AUTO_CHECKOUT,
    async () => {
      await enqueueJob(QUEUE_NAMES.ATTENDANCE_AUTO_CHECKOUT, {});
    },
  );
}
