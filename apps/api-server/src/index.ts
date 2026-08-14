import { pool, workerPool } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { getSmsProvider, logSmsBalanceIfConfigured } from "./lib/sms";
import { warmTestOtpNumbers } from "./lib/otp-test-numbers";
import { warmOtpConfig } from "./lib/otp-config";
import { assertProductionRedisConfigured } from "./lib/assert-production-redis";
import { registerAllJobs } from "./jobs/register-all";
import { attachAdminDashboardFeed } from "./lib/admin-dashboard-feed";
import { startQueueWorkers, shutdownQueues } from "./lib/queues";
import { isWorkerProcess, shouldRunWorkersAndCrons } from "./lib/process-role";

if (isWorkerProcess()) {
  throw new Error(
    "PROCESS_ROLE=worker must use the worker entry (dist/worker.mjs / pnpm run start:worker), not the API entry.",
  );
}

// PERF #15 — default API-only. RUN_WORKERS_INLINE=1 keeps single-container
// behaviour (handlers + BullMQ consumers + crons in this process).
const runInlineWorkers = shouldRunWorkersAndCrons();
if (runInlineWorkers) {
  registerAllJobs();
  startQueueWorkers();
  logger.info("RUN_WORKERS_INLINE=1 — workers and crons run inside the API process");
}

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
  // Crons live on the worker process (PERF #15). Only start here under the
  // single-container escape hatch — avoids overlapping crons on every API replica.
  if (runInlineWorkers) {
    startScheduler();
  }

  // Eagerly construct the SMS provider in production so a missing/invalid SMS
  // config fails LOUDLY at boot. Without this, getSmsProvider()'s prod
  // fail-fast only fires on the first login attempt and is swallowed by the
  // auth route's try/catch — the server would report healthy while nobody can
  // log in. In non-prod the mock provider is used, so skip this.
  if (process.env["NODE_ENV"] === "production") {
    try {
      getSmsProvider();
      void logSmsBalanceIfConfigured();
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
  warmOtpConfig();
});

// PERF #18 — nginx upstream keepalive defaults to 60s; Node's keepAliveTimeout
// must exceed it or the proxy races a closing socket and returns 502.
// requestTimeout excludes the upload path carve-out below (multer streams).
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;
server.requestTimeout = 30_000;
server.on("request", (req, res) => {
  // Large homework/proof uploads legitimately exceed 30s on slow links.
  if (req.url?.startsWith("/v1/uploads")) {
    req.setTimeout(10 * 60_000);
    res.setTimeout(10 * 60_000);
  }
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
    try {
      await shutdownQueues();
    } catch (qErr) {
      logger.error({ err: qErr }, "Error while shutting down queues");
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
