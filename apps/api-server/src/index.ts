import { pool, workerPool } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { getSmsProvider } from "./lib/sms";
import { warmTestOtpNumbers } from "./lib/otp-test-numbers";
import { assertProductionRedisConfigured } from "./lib/assert-production-redis";
import { registerSessionLifecycleJobs } from "./jobs/session-lifecycle-jobs";
import { registerDerivedDataJobs } from "./jobs/derived-data-jobs";
import { attachAdminDashboardFeed } from "./lib/admin-dashboard-feed";
import { startQueueWorkers } from "./lib/queues";

// Register queue handlers + cron enqueuers before the scheduler starts.
registerSessionLifecycleJobs();
registerDerivedDataJobs();
startQueueWorkers();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Last-resort process guards: log the failure with full context instead of
// crashing silently. An uncaught exception leaves the process in an unknown
// state, so we exit after logging; an unhandled rejection is logged but kept
// non-fatal to avoid taking the server down for a single stray promise.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  // Also write straight to stderr: if the logger transport is itself broken,
  // routing the fatal through it alone would swallow the cause.
  process.stderr.write(
    `uncaughtException: ${String((err as Error)?.stack ?? err)}\n`,
  );
  logger.fatal({ err }, "Uncaught exception; shutting down");
  process.exit(1);
});

// Bind address: defaults to 0.0.0.0, but behind a reverse proxy (nginx in the
// Docker/host setup) set HOST=127.0.0.1 so the port isn't exposed publicly.
const host = process.env["HOST"] || "0.0.0.0";
const server = app.listen(port, host, () => {
  logger.info({ port, host }, "Server listening");
  attachAdminDashboardFeed(server);
  // Start cron jobs (birthday wishes, etc.) only in the running server process.
  startScheduler();

  // Eagerly construct the SMS provider in production so a missing/invalid SMS
  // config fails LOUDLY at boot. Without this, getSmsProvider()'s prod
  // fail-fast only fires on the first login attempt and is swallowed by the
  // auth route's try/catch — the server would report healthy while nobody can
  // log in. In non-prod the mock provider is used, so skip this.
  if (process.env["NODE_ENV"] === "production") {
    try {
      getSmsProvider();
    } catch (err) {
      logger.fatal({ err }, "SMS provider unavailable in production; refusing to start");
      process.exit(1);
    }
    // PERF #5 — without Redis, BullMQ debounce collapses to inline execution
    // inside the HTTP request (quadratic in marks per session on AT31 bursts).
    try {
      assertProductionRedisConfigured();
    } catch (err) {
      logger.fatal({ err }, "Redis unavailable in production; refusing to start");
      process.exit(1);
    }
  }

  // Parse the store-review test-number allow-list at boot too, so its "ACTIVE"
  // warning lands in the startup logs. Lazily it would only appear on the first
  // login, i.e. exactly when nobody is reading — and an allow-list left behind
  // after review is precisely the thing that should be impossible to miss.
  warmTestOtpNumbers();
});

// Graceful shutdown: stop accepting new connections, let in-flight requests
// drain, then exit. A timeout guards against connections that never close.
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Received shutdown signal; closing server");

  const forceExit = setTimeout(() => {
    logger.error("Graceful shutdown timed out; forcing exit");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async (err) => {
    if (err) {
      logger.error({ err }, "Error while closing server");
      process.exit(1);
    }
    // Drain both pg pools so in-flight DB work finishes and connections close
    // cleanly. Never let a pool-drain failure block the exit — log and proceed.
    try {
      await Promise.all([pool.end(), workerPool.end()]);
    } catch (poolErr) {
      logger.error({ err: poolErr }, "Error while draining pg pools");
    }
    logger.info("Server closed; exiting");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
