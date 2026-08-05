/**
 * Frozen cron: notifications.birthday @ 06:00 IST.
 * Lives here (not in the notifications route) so importing the HTTP router
 * does not register cron work on every API instance (PERF #15 / #16).
 */
import { QUEUE_NAMES, CRON_EXPRESSIONS } from "@jp/shared/constants";
import { registerQueueHandler, enqueueJob, dailyCronJobId } from "../lib/queues";
import { registerCron } from "../lib/scheduler";
import { todayIst } from "../services/session-materialise";
import { runBirthdayWishes } from "../routes/v1/notifications";

let registered = false;

export function registerBirthdayJobs(): void {
  if (registered) return;
  registered = true;

  registerQueueHandler(QUEUE_NAMES.NOTIFICATIONS_BIRTHDAY, async () => {
    await runBirthdayWishes();
  });

  registerCron(
    QUEUE_NAMES.NOTIFICATIONS_BIRTHDAY,
    CRON_EXPRESSIONS.NOTIFICATIONS_BIRTHDAY,
    async () => {
      await enqueueJob(
        QUEUE_NAMES.NOTIFICATIONS_BIRTHDAY,
        {},
        { jobId: dailyCronJobId("birthday", todayIst()) },
      );
    },
  );
}
