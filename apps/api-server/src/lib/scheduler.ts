/**
 * Lightweight cron registry. Modules register jobs at import time via
 * registerCron(); the server process starts them once via startScheduler()
 * (called from index.ts). Tests never call startScheduler(), so no timers fire.
 */
import cron from "node-cron";
import { logger } from "./logger";

interface CronJob {
  name: string;
  expression: string;
  handler: () => Promise<void> | void;
}

const jobs: CronJob[] = [];
let started = false;

/** Register a job. Safe to call at module import; does not start a timer. */
export function registerCron(name: string, expression: string, handler: () => Promise<void> | void): void {
  if (!cron.validate(expression)) {
    logger.error({ name, expression }, "Invalid cron expression; job not registered");
    return;
  }
  jobs.push({ name, expression, handler });
}

/** Start all registered jobs. Idempotent. Call once from the server entrypoint. */
export function startScheduler(timezone = process.env["CRON_TZ"] ?? "Asia/Kolkata"): void {
  if (started) return;
  started = true;
  for (const job of jobs) {
    cron.schedule(
      job.expression,
      async () => {
        try {
          await job.handler();
        } catch (err) {
          logger.error({ err, job: job.name }, "Scheduled job failed");
        }
      },
      { timezone },
    );
    logger.info({ job: job.name, expression: job.expression, timezone }, "Scheduled job registered");
  }
}
