/**
 * Register every BullMQ handler + cron enqueuer once.
 * Called from the worker entry (always) and from the API entry only when
 * RUN_WORKERS_INLINE=1 (PERF #15 single-container escape hatch).
 */
import { registerSessionLifecycleJobs } from "./session-lifecycle-jobs";
import { registerDerivedDataJobs } from "./derived-data-jobs";
import { registerExamJobs } from "./exam-jobs";
import { registerIdCardJobs } from "./idcard-jobs";
import { registerBirthdayJobs } from "./birthday-jobs";

let registered = false;

export function registerAllJobs(): void {
  if (registered) return;
  registered = true;
  registerSessionLifecycleJobs();
  registerDerivedDataJobs();
  registerExamJobs();
  registerIdCardJobs();
  registerBirthdayJobs();
}
