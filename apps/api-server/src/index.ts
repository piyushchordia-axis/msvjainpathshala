import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";

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
  // Start cron jobs (birthday wishes, etc.) only in the running server process.
  startScheduler();
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

  server.close((err) => {
    if (err) {
      logger.error({ err }, "Error while closing server");
      process.exit(1);
    }
    logger.info("Server closed; exiting");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
