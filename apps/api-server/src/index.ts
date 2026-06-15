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
  logger.fatal({ err }, "Uncaught exception; shutting down");
  process.exit(1);
});

const server = app.listen(port, "0.0.0.0", () => {
  logger.info({ port, host: "0.0.0.0" }, "Server listening");
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
