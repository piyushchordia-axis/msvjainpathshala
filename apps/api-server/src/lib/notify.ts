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

/** Honour users.notification_preferences before enqueueing a given kind. */
export function prefsAllowKind(prefs: unknown, kind: string): boolean {
  if (!prefs || typeof prefs !== "object") return true;
  const p = prefs as Record<string, unknown>;
  if (p.push === false) return false;
  if (p[kind] === false) return false;
  return true;
}

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
  /** Deep-link payload; merged with `{ kind }` so kind is always present. */
  data?: Record<string, unknown>;
}): Promise<void> {
  const ids = [...new Set(opts.userIds)].filter(Boolean);
  if (ids.length === 0) return;

  // AT31 — honour users.notification_preferences before enqueueing.
  const prefRows = await db
    .select({
      id: users.id,
      prefs: users.notification_preferences,
      preferred_language: users.preferred_language,
    })
    .from(users)
    .where(inArray(users.id, ids));
  const kind = opts.kind ?? "general";
  const allowedIds = prefRows
    .filter((r) => prefsAllowKind(r.prefs, kind))
    .map((r) => r.id);
  // Users missing from the prefs query (shouldn't happen) stay allowed.
  const known = new Set(prefRows.map((r) => r.id));
  for (const id of ids) if (!known.has(id)) allowedIds.push(id);
  if (allowedIds.length === 0) return;

  const langByUser = new Map(
    prefRows.map((r) => [r.id, r.preferred_language] as const),
  );

  if (opts.inbox !== false) {
    await db.insert(notifications).values(
      allowedIds.map((user_id) => ({
        user_id,
        kind,
        title_en: opts.title_en,
        title_hi: opts.title_hi,
        body_en: opts.body_en,
        body_hi: opts.body_hi,
      })),
    );
  }

  if (opts.push !== false) {
    try {
      const tokens = await db
        .select({
          user_id: device_push_tokens.user_id,
          expo_token: device_push_tokens.expo_token,
        })
        .from(device_push_tokens)
        .where(
          and(
            inArray(device_push_tokens.user_id, allowedIds),
            eq(device_push_tokens.is_active, true),
          ),
        );
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
  const rows = await db
    .select({ user_id: sanchalak_centre_assignments.user_id })
    .from(sanchalak_centre_assignments)
    .where(
      and(
        eq(sanchalak_centre_assignments.centre_id, centreId),
        eq(sanchalak_centre_assignments.is_active, true),
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
