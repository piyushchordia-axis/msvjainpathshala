/**
 * Bounded retention deletes for sync_operations and read notifications (PERF #8).
 * Called from auth.session.cleanup — never unbounded DELETE.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const BATCH = 5000;

export type RetentionResult = {
  sync_operations_deleted: number;
  notifications_deleted: number;
};

/**
 * Replay-safe sync_operations rule:
 * - Eligible: status IN ('success','duplicate') AND applied_at older than `days`
 * - Kept forever (for now): 'failed', 'processing', 'conflict' — still needed for
 *   manual retry / in-flight claim / conflict UI, regardless of age.
 */
export async function pruneSyncOperations(days = 30): Promise<number> {
  let total = 0;
  for (;;) {
    const result = await db.execute(sql`
      with doomed as (
        select id
        from sync_operations
        where status in ('success', 'duplicate')
          and applied_at < now() - make_interval(days => ${days})
        order by applied_at
        limit ${BATCH}
      )
      delete from sync_operations s
      using doomed
      where s.id = doomed.id
      returning s.id
    `);
    const n =
      (result as unknown as { rowCount?: number; rows?: unknown[] }).rowCount ??
      (result as unknown as { rows?: unknown[] }).rows?.length ??
      0;
    total += n;
    if (n < BATCH) break;
  }
  return total;
}

/** Read rows: pruned at the ordinary horizon — nobody is still waiting to see these. */
export async function pruneReadNotifications(days = 90): Promise<number> {
  let total = 0;
  for (;;) {
    const result = await db.execute(sql`
      with doomed as (
        select id
        from notifications
        where read_at is not null
          and created_at < now() - make_interval(days => ${days})
        order by created_at
        limit ${BATCH}
      )
      delete from notifications n
      using doomed
      where n.id = doomed.id
      returning n.id
    `);
    const n =
      (result as unknown as { rowCount?: number; rows?: unknown[] }).rowCount ??
      (result as unknown as { rows?: unknown[] }).rows?.length ??
      0;
    total += n;
    if (n < BATCH) break;
  }
  return total;
}

/**
 * X-21 (review 2026-08) — unread rows were never pruned by design (nobody
 * has seen them, so age alone is not enough to justify deletion), but "never
 * pruned" had no ceiling at all: an inactive user's inbox grew without
 * bound forever. A long horizon (default 2 years) is the ceiling — far
 * beyond any realistic "I'll get to it" window, short of infinity.
 */
export async function pruneStaleUnreadNotifications(days = 730): Promise<number> {
  let total = 0;
  for (;;) {
    const result = await db.execute(sql`
      with doomed as (
        select id
        from notifications
        where read_at is null
          and created_at < now() - make_interval(days => ${days})
        order by created_at
        limit ${BATCH}
      )
      delete from notifications n
      using doomed
      where n.id = doomed.id
      returning n.id
    `);
    const n =
      (result as unknown as { rowCount?: number; rows?: unknown[] }).rowCount ??
      (result as unknown as { rows?: unknown[] }).rows?.length ??
      0;
    total += n;
    if (n < BATCH) break;
  }
  return total;
}

export async function runRetentionPrune(): Promise<RetentionResult> {
  const sync_operations_deleted = await pruneSyncOperations(30);
  const notifications_deleted =
    (await pruneReadNotifications(90)) + (await pruneStaleUnreadNotifications(730));
  return { sync_operations_deleted, notifications_deleted };
}
