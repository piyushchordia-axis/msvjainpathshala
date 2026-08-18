/**
 * v3 §17.9 — library access logging.
 *
 * Distinct reach, not an event stream: one row per (target, actor, event) whose
 * `access_count` climbs on repeat. A reader who opens the same stotra every
 * morning is one reader, and 0048 collapsed the original append-forever table
 * for exactly that reason.
 *
 * A target is an item OR a section, never both. Most events fire on a piece of
 * content; `granth_view` is a section open (§17.11.1), and a section id sent
 * down the item path matches no library_item and vanishes.
 *
 * Analytics only. Nothing here awards Punya — §17.8 is explicit that the
 * Library never calls PunyaService, and a "log this" endpoint that moved a
 * balance would be a points faucet any client could turn.
 */
import { db, library_access_logs, library_items, library_sections } from "@workspace/db";
import type { LibraryAccessEvent } from "@workspace/api-zod";
import { and, eq, isNull, sql } from "drizzle-orm";

import { logger } from "./logger";

export type AccessActor = {
  userId: string | null;
  deviceId: string | null;
};

/** Exactly one of these is set. */
export type AccessTarget = { itemId: string } | { sectionId: string };

/**
 * Record one access. Returns false when the target is unknown/unpublished or
 * the caller is unidentifiable; never throws — an analytics write must not be
 * able to fail a reader's tap.
 */
export async function recordLibraryAccess(
  target: AccessTarget,
  event: LibraryAccessEvent,
  actor: AccessActor,
): Promise<boolean> {
  if (!actor.userId && !actor.deviceId) return false;
  try {
    // Published targets only. Accepting a draft id would let a caller probe for
    // unpublished content by watching which ids come back recorded.
    const values: {
      library_item_id?: string;
      library_section_id?: string;
      user_id: string | null;
      device_id: string | null;
      event: LibraryAccessEvent;
    } = {
      user_id: actor.userId,
      device_id: actor.deviceId,
      event,
    };

    if ("itemId" in target) {
      const [row] = await db
        .select({ id: library_items.id })
        .from(library_items)
        .where(
          and(
            eq(library_items.id, target.itemId),
            isNull(library_items.deleted_at),
            eq(library_items.is_published, true),
          ),
        )
        .limit(1);
      if (!row) return false;
      values.library_item_id = row.id;
    } else {
      const [row] = await db
        .select({ id: library_sections.id })
        .from(library_sections)
        .where(
          and(
            eq(library_sections.id, target.sectionId),
            isNull(library_sections.deleted_at),
            eq(library_sections.is_published, true),
          ),
        )
        .limit(1);
      if (!row) return false;
      values.library_section_id = row.id;
    }

    const bump = {
      access_count: sql`${library_access_logs.access_count} + 1`,
      last_accessed_at: sql`now()`,
      updated_at: sql`now()`,
    };

    // Four partial unique indexes back this table (target kind × actor kind), so
    // the conflict target has to name the one that applies. `device_id` is
    // stored for signed-in callers too — useful for per-device reach — but never
    // participates in their uniqueness.
    const targetCol = values.library_item_id
      ? library_access_logs.library_item_id
      : library_access_logs.library_section_id;
    const targetNotNull = values.library_item_id
      ? sql`${library_access_logs.library_item_id} IS NOT NULL`
      : sql`${library_access_logs.library_section_id} IS NOT NULL`;

    if (actor.userId) {
      await db
        .insert(library_access_logs)
        .values(values)
        .onConflictDoUpdate({
          target: [targetCol, library_access_logs.event, library_access_logs.user_id],
          targetWhere: sql`${targetNotNull} AND ${library_access_logs.user_id} IS NOT NULL`,
          set: bump,
        });
      return true;
    }

    await db
      .insert(library_access_logs)
      .values(values)
      .onConflictDoUpdate({
        target: [targetCol, library_access_logs.event, library_access_logs.device_id],
        targetWhere: sql`${targetNotNull} AND ${library_access_logs.user_id} IS NULL AND ${library_access_logs.device_id} IS NOT NULL`,
        set: bump,
      });
    return true;
  } catch (err) {
    logger.warn({ err, target, event }, "library access log write failed");
    return false;
  }
}

/**
 * First-login re-key, matching the download and content-request rules (§17.4,
 * §17.10.2): the guest rows for this device become the account's.
 *
 * Rows the account already has for the same (target, event) would violate the
 * user-scoped unique index, so their counts are folded in and the device row is
 * dropped. Leaving both would count one human twice, which is the one thing a
 * distinct-reach table exists to avoid.
 *
 * Never throws — this runs inside OTP verify, and a failed analytics merge must
 * not cost someone their login.
 */
export async function rekeyDeviceAccessLogsToUser(
  userId: string,
  deviceId: string | null | undefined,
): Promise<void> {
  if (!deviceId) return;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        WITH merged AS (
          UPDATE library_access_logs AS u
             SET access_count = u.access_count + d.access_count,
                 last_accessed_at = GREATEST(u.last_accessed_at, d.last_accessed_at),
                 accessed_at = LEAST(u.accessed_at, d.accessed_at),
                 updated_at = now()
            FROM library_access_logs AS d
           WHERE u.user_id = ${userId}
             AND d.user_id IS NULL
             AND d.device_id = ${deviceId}
             AND u.library_item_id IS NOT DISTINCT FROM d.library_item_id
             AND u.library_section_id IS NOT DISTINCT FROM d.library_section_id
             AND u.event = d.event
          RETURNING d.id
        )
        DELETE FROM library_access_logs
         WHERE id IN (SELECT id FROM merged)
      `);

      await tx.execute(sql`
        UPDATE library_access_logs
           SET user_id = ${userId}, updated_at = now()
         WHERE user_id IS NULL AND device_id = ${deviceId}
      `);
    });
  } catch (err) {
    logger.warn({ err, userId }, "library access log re-key failed");
  }
}
