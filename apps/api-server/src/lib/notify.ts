/**
 * In-app notifications (+ optional Expo push).
 * Preference reads and inbox inserts propagate failures so queue jobs can retry.
 * Push delivery is best-effort and never throws.
 */
import {
  db,
  notifications,
  device_push_tokens,
  users,
  sanchalak_centre_assignments,
  centres,
  students,
  NOTIFICATION_KINDS,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { sendPush } from "./push";
import { logger } from "./logger";

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * X-1 (review 2026-08) — two independent gates, previously collapsed into
 * one. A user who disables push for a *kind* should see no notification of
 * that kind at all (neither push nor inbox row). A user who disables the
 * push *channel* only should still get the durable inbox row — the schema
 * comment on `notifications` calls the inbox "the fallback when push isn't
 * delivered"; collapsing the two gates made it the same switch instead.
 */
export function prefsAllowKind(prefs: unknown, kind: string): boolean {
  if (!prefs || typeof prefs !== "object") return true;
  const p = prefs as Record<string, unknown>;
  return p[kind] !== false;
}

/** Channel gate: suppresses only the Expo push send, never the inbox row. */
export function prefsAllowPush(prefs: unknown): boolean {
  if (!prefs || typeof prefs !== "object") return true;
  const p = prefs as Record<string, unknown>;
  return p.push !== false;
}

/** Splits an array into chunks of at most `size` items. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// X-7 — Postgres caps bind parameters at 65535. Insert rows carry 6 columns,
// so 500/insert stays comfortably under that even for the widest emitter.
// IN-lists get their own, larger cap since they bind one param each.
const INSERT_CHUNK_SIZE = 500;
const IN_LIST_CHUNK_SIZE = 1000;

export async function notifyUsers(opts: {
  userIds: string[];
  kind?: NotificationKind;
  title_en: string;
  title_hi: string;
  body_en: string;
  body_hi: string;
  push?: boolean;
  /**
   * When false, skip the durable inbox insert (caller already wrote the row —
   * e.g. birthday cron under its advisory lock). Default true.
   */
  inbox?: boolean;
  /** Deep-link payload; merged with `{ kind }` so kind is always present, and
   * persisted onto the durable `notifications.data` column (X-9) as well as
   * the push payload. */
  data?: Record<string, unknown>;
}): Promise<void> {
  const ids = [...new Set(opts.userIds)].filter(Boolean);
  if (ids.length === 0) return;

  const kind = opts.kind ?? "general";

  // AT31 — honour users.notification_preferences before enqueueing.
  // X-13 — also filter deactivated users centrally, rather than leaving it
  // to individual reviewer-resolution helpers to remember.
  type PrefRow = {
    id: string;
    prefs: unknown;
    preferred_language: string | null;
  };
  const prefRows: PrefRow[] = [];
  for (const idChunk of chunk(ids, IN_LIST_CHUNK_SIZE)) {
    const rows = await db
      .select({
        id: users.id,
        prefs: users.notification_preferences,
        preferred_language: users.preferred_language,
      })
      .from(users)
      .where(and(inArray(users.id, idChunk), eq(users.is_active, true)));
    prefRows.push(...rows);
  }

  // X-12 — an id absent from the prefs query violates notifications.user_id's
  // FK (it doesn't exist, or isn't active), so it can never be notified —
  // drop it instead of force-allowing it and letting one bad id fail the
  // whole insert.
  const kindAllowedIds = prefRows
    .filter((r) => prefsAllowKind(r.prefs, kind))
    .map((r) => r.id);
  if (kindAllowedIds.length === 0) {
    logger.info({ kind, requested: ids.length }, "notifyUsers: no kind-allowed recipients");
    return;
  }

  const langByUser = new Map(
    prefRows.map((r) => [r.id, r.preferred_language] as const),
  );
  const prefsById = new Map(prefRows.map((r) => [r.id, r.prefs] as const));

  if (opts.inbox !== false) {
    for (const idChunk of chunk(kindAllowedIds, INSERT_CHUNK_SIZE)) {
      try {
        await db.insert(notifications).values(
          idChunk.map((user_id) => ({
            user_id,
            kind,
            title_en: opts.title_en,
            title_hi: opts.title_hi,
            body_en: opts.body_en,
            body_hi: opts.body_hi,
            data: opts.data ?? null,
          })),
        );
      } catch (err) {
        logger.error({ err, kind, count: idChunk.length }, "notifyUsers inbox insert chunk failed");
      }
    }
  }

  if (opts.push !== false) {
    // Channel gate applies on top of the kind gate — push:false suppresses
    // only the send, not the inbox row already written above.
    const pushAllowedIds = kindAllowedIds.filter((id) => prefsAllowPush(prefsById.get(id)));
    if (pushAllowedIds.length === 0) return;
    try {
      const tokens: { user_id: string; expo_token: string }[] = [];
      for (const idChunk of chunk(pushAllowedIds, IN_LIST_CHUNK_SIZE)) {
        const rows = await db
          .select({
            user_id: device_push_tokens.user_id,
            expo_token: device_push_tokens.expo_token,
          })
          .from(device_push_tokens)
          .where(
            and(
              inArray(device_push_tokens.user_id, idChunk),
              eq(device_push_tokens.is_active, true),
            ),
          );
        tokens.push(...rows);
      }
      if (tokens.length > 0) {
        const data = { kind, ...(opts.data ?? {}) };
        await sendPush(
          tokens.map((t) => {
            const hi = langByUser.get(t.user_id) === "hi";
            return {
              to: t.expo_token,
              title: hi ? opts.title_hi : opts.title_en,
              body: hi ? opts.body_hi : opts.body_en,
              data,
            };
          }),
        );
      }
    } catch (err) {
      logger.warn({ err }, "notifyUsers push failed");
    }
  }
}

export async function sanchalakUserIdsForCentre(centreId: string): Promise<string[]> {
  // X-13 — the assignment's is_active only says the assignment is live, not
  // that the sanchalak's own account is. Join users so a deactivated
  // sanchalak with a stale-but-live assignment stops receiving centre alerts.
  const rows = await db
    .select({ user_id: sanchalak_centre_assignments.user_id })
    .from(sanchalak_centre_assignments)
    .innerJoin(users, eq(users.id, sanchalak_centre_assignments.user_id))
    .where(
      and(
        eq(sanchalak_centre_assignments.centre_id, centreId),
        eq(sanchalak_centre_assignments.is_active, true),
        eq(users.is_active, true),
      ),
    );
  return rows.map((r) => r.user_id);
}

export async function cityAdminUserIdsForCentre(centreId: string): Promise<string[]> {
  const [centre] = await db
    .select({ city_id: centres.city_id })
    .from(centres)
    .where(eq(centres.id, centreId))
    .limit(1);
  if (!centre?.city_id) return [];
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "city_admin"),
        eq(users.city_id, centre.city_id),
        eq(users.is_active, true),
      ),
    );
  return rows.map((r) => r.id);
}

export async function parentUserIdsForBatch(batchId: string): Promise<string[]> {
  const rows = await db
    .select({ parent_id: students.parent_id })
    .from(students)
    .where(and(eq(students.batch_id, batchId), eq(students.status, "active")));
  return rows.map((r) => r.parent_id).filter((id): id is string => !!id);
}
