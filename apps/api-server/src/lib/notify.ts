/**
 * Best-effort in-app notifications (+ optional Expo push). Never throws.
 */
import {
  db,
  notifications,
  device_push_tokens,
  users,
  sanchalak_centre_assignments,
  centres,
  students,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { sendPush } from "./push";
import { logger } from "./logger";

function prefsAllowKind(prefs: unknown, kind: string): boolean {
  if (!prefs || typeof prefs !== "object") return true;
  const p = prefs as Record<string, unknown>;
  if (p.push === false) return false;
  if (p[kind] === false) return false;
  return true;
}

export async function notifyUsers(opts: {
  userIds: string[];
  kind?:
    | "general"
    | "birthday"
    | "homework"
    | "quiz"
    | "competition"
    | "service_request"
    | "exam"
    | "shivir"
    | "niyam_rejected"
    | "niyam_badge";
  title_en: string;
  title_hi: string;
  body_en: string;
  body_hi: string;
  push?: boolean;
}): Promise<void> {
  const ids = [...new Set(opts.userIds)].filter(Boolean);
  if (ids.length === 0) return;
  try {
    // AT31 — honour users.notification_preferences before enqueueing.
    const prefRows = await db
      .select({ id: users.id, prefs: users.notification_preferences })
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
    if (opts.push !== false) {
      const tokens = await db
        .select({ expo_token: device_push_tokens.expo_token })
        .from(device_push_tokens)
        .where(
          and(inArray(device_push_tokens.user_id, allowedIds), eq(device_push_tokens.is_active, true)),
        );
      if (tokens.length > 0) {
        await sendPush(
          tokens.map((t) => ({
            to: t.expo_token,
            title: opts.title_en,
            body: opts.body_en,
          })),
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, "notifyUsers failed");
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
