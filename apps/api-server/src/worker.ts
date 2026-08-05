/**
 * Worker process entry (PERF #15) — BullMQ consumers + crons only.
 * No HTTP listener, no Express app import. Pair with the API process
 * (dist/index.mjs). Set PROCESS_ROLE=worker (this file sets it if unset).
 *
 * Subsumes PERF #17's "cron overlap across HTTP replicas" finding: with the
 * split, startScheduler() runs only here (or under RUN_WORKERS_INLINE=1),
 * not on every API instance.
 */
process.env.PROCESS_ROLE ??= "worker";
// libuv threadpool for argon2 / sharp / dns — HTTP process keeps the default.
process.env.UV_THREADPOOL_SIZE ??= "8";

import sharp from "sharp";
import { pool, workerPool } from "@workspace/db";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { assertProductionRedisConfigured } from "./lib/assert-production-redis";
import { registerAllJobs } from "./jobs/register-all";
import { startQueueWorkers, shutdownQueues } from "./lib/queues";

// One libvips job at a time in the worker — avoid RAM spikes from parallel sharp.
sharp.concurrency(1);

registerAllJobs();
startQueueWorkers();
startScheduler();

logger.info(
  {
    process_role: process.env.PROCESS_ROLE,
    uv_threadpool_size: process.env.UV_THREADPOOL_SIZE,
    sharp_concurrency: 1,
  },
  "Worker process started (queues + crons; no HTTP)",
);

if (process.env.NODE_ENV === "production") {
  try {
    assertProductionRedisConfigured();
  } catch (err) {
    logger.fatal({ err }, "Redis unavailable in production worker; refusing to start");
    process.exit(1);
  }
}

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  process.stderr.write(`uncaughtException: ${String((err as Error)?.stack ?? err)}\n`);
  logger.fatal({ err }, "Uncaught exception; shutting down worker");
  process.exit(1);
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Received shutdown signal; draining worker");

  const forceExit = setTimeout(() => {
    logger.error("Worker graceful shutdown timed out; forcing exit");
    process.exit(1);
  }, 30_000);
  forceExit.unref();

  try {
    await shutdownQueues();
  } catch (err) {
    logger.error({ err }, "Error while shutting down queues");
  }
  try {
    await Promise.all([pool.end(), workerPool.end()]);
  } catch (poolErr) {
    logger.error({ err: poolErr }, "Error while draining pg pools");
  }
  logger.info("Worker closed; exiting");
  process.exit(0);
}

process.on("SIGTERM", (s) => void shutdown(s));
process.on("SIGINT", (s) => void shutdown(s));
