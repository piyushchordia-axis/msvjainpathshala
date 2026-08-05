/**
 * Process role helpers (PERF #15).
 * - api (default): HTTP only
 * - worker: BullMQ consumers + crons, no HTTP listener
 * - RUN_WORKERS_INLINE=1: single-container escape hatch (API also runs workers/crons)
 */
export type ProcessRole = "api" | "worker";

export function getProcessRole(): ProcessRole {
  const raw = (process.env.PROCESS_ROLE ?? "api").trim().toLowerCase();
  return raw === "worker" ? "worker" : "api";
}

export function isWorkerProcess(): boolean {
  return getProcessRole() === "worker";
}

/** True when this process should register handlers, start BullMQ workers, and run crons. */
export function shouldRunWorkersAndCrons(): boolean {
  if (isWorkerProcess()) return true;
  return process.env.RUN_WORKERS_INLINE === "1";
}
