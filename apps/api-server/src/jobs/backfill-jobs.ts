/**
 * Generic data backfills on QUEUE_NAMES.DB_BACKFILL_GENERIC.
 * Dispatch on payload.kind — do not add per-feature backfill queues.
 */
import { QUEUE_NAMES } from "@jp/shared/constants";
import { registerQueueHandler, enqueueJob } from "../lib/queues";
import { backfillTeamMembersFromUsers } from "../lib/team-members-sync";
import { logger } from "../lib/logger";

let registered = false;

export function registerBackfillJobs(): void {
  if (registered) return;
  registered = true;

  registerQueueHandler(QUEUE_NAMES.DB_BACKFILL_GENERIC, async (data) => {
    const kind = String((data as { kind?: string }).kind ?? "");
    if (kind === "team_members") {
      await backfillTeamMembersFromUsers();
      return;
    }
    logger.warn({ kind }, "db.backfill.generic: unknown kind — ignored");
  });

  // One-shot historical sync for staff/admin users created before Team sync.
  // Idempotent upsert; jobId dedupes across worker restarts while the job is
  // waiting/active (re-runs after completion are safe).
  void enqueueJob(
    QUEUE_NAMES.DB_BACKFILL_GENERIC,
    { kind: "team_members" },
    { jobId: "backfill:team_members:v1" },
  ).catch((err) => {
    logger.warn({ err }, "Failed to enqueue team_members backfill");
  });
}
