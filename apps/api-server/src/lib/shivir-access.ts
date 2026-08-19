/**
 * Shivir scope + authorization, shared by the online scanner routes, the
 * /v1/sync/batch handler, the admin routes and the Socket.IO namespace gate.
 *
 * Why this file exists: the rule used to live as private helpers inside
 * routes/v1/shivir-scanner.ts, so the offline transport — which reaches the
 * same domain service — enforced nothing at all. Any authenticated parent could
 * replay their own child's signed QR into any shivir session in the country.
 * One rule, one place, every caller.
 *
 * SPEC 6.14 role sets (see SHIVIR_OPS_ROLES in @workspace/api-zod): a shikshak
 * is NOT admitted by role. A Guruji at a venue scans because they hold a
 * volunteer assignment for that shivir, which is what makes the scan
 * attributable to a person who was actually there.
 */
import { db, shivir_events, shivir_sessions, shivir_volunteers, type User } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { canOperateShivirs } from "@workspace/api-zod";
import { cityIdsForUser } from "./scope";

export interface ShivirRef {
  id: string;
  city_id: string | null;
  name_en: string;
  name_hi: string | null;
  start_date: string;
  end_date: string;
  capacity: number | null;
  msv_only: boolean;
  is_published: boolean;
  attendance_mode: "in_out" | "present_only";
}

/** Fetch a live (not soft-deleted) shivir, or null. */
export async function getShivir(shivirId: string): Promise<ShivirRef | null> {
  const [row] = await db
    .select({
      id: shivir_events.id,
      city_id: shivir_events.city_id,
      name_en: shivir_events.name_en,
      name_hi: shivir_events.name_hi,
      start_date: shivir_events.start_date,
      end_date: shivir_events.end_date,
      capacity: shivir_events.capacity,
      msv_only: shivir_events.msv_only,
      is_published: shivir_events.is_published,
      attendance_mode: shivir_events.attendance_mode,
    })
    .from(shivir_events)
    .where(and(eq(shivir_events.id, shivirId), isNull(shivir_events.deleted_at)))
    .limit(1);
  return row ?? null;
}

/** Resolve a session to its shivir in one round trip. */
export async function getShivirForSession(
  sessionId: string,
): Promise<{ session: { id: string; shivir_id: string; attendance_mode: "in_out" | "present_only" }; shivir: ShivirRef } | null> {
  const [row] = await db
    .select({
      session_id: shivir_sessions.id,
      shivir_id: shivir_sessions.shivir_id,
      session_mode: shivir_sessions.attendance_mode,
      shivir_city_id: shivir_events.city_id,
      shivir_name_en: shivir_events.name_en,
      shivir_name_hi: shivir_events.name_hi,
      shivir_start: shivir_events.start_date,
      shivir_end: shivir_events.end_date,
      shivir_capacity: shivir_events.capacity,
      shivir_msv_only: shivir_events.msv_only,
      shivir_published: shivir_events.is_published,
      shivir_mode: shivir_events.attendance_mode,
    })
    .from(shivir_sessions)
    .innerJoin(shivir_events, eq(shivir_events.id, shivir_sessions.shivir_id))
    .where(and(eq(shivir_sessions.id, sessionId), isNull(shivir_events.deleted_at)))
    .limit(1);
  if (!row) return null;
  return {
    session: { id: row.session_id, shivir_id: row.shivir_id, attendance_mode: row.session_mode },
    shivir: {
      id: row.shivir_id,
      city_id: row.shivir_city_id,
      name_en: row.shivir_name_en,
      name_hi: row.shivir_name_hi,
      start_date: row.shivir_start,
      end_date: row.shivir_end,
      capacity: row.shivir_capacity,
      msv_only: row.shivir_msv_only,
      is_published: row.shivir_published,
      attendance_mode: row.shivir_mode,
    },
  };
}

export function cityInScope(cityIds: string[] | null, cityId: string | null): boolean {
  if (cityIds === null) return true;
  if (!cityId) return false;
  return cityIds.includes(cityId);
}

/** True when the caller holds a live (un-revoked) volunteer assignment. */
export async function isActiveVolunteer(userId: string, shivirId: string): Promise<boolean> {
  const [vol] = await db
    .select({ id: shivir_volunteers.id })
    .from(shivir_volunteers)
    .where(
      and(
        eq(shivir_volunteers.shivir_id, shivirId),
        eq(shivir_volunteers.user_id, userId),
        isNull(shivir_volunteers.revoked_at),
      ),
    )
    .limit(1);
  return !!vol;
}

/**
 * May this caller act on this shivir? Either an ops-role admin whose city scope
 * covers it, or a live volunteer assignment for this specific shivir.
 */
export async function canActOnShivir(
  user: User,
  shivirCityId: string | null,
  shivirId: string,
): Promise<boolean> {
  if (canOperateShivirs(user.role)) {
    const cityIds = await cityIdsForUser(user);
    if (cityInScope(cityIds, shivirCityId)) return true;
  }
  return isActiveVolunteer(user.id, shivirId);
}

export type ShivirAccessDenied = { ok: false; code: "ERR_NOT_FOUND"; message: string };
export type ShivirAccessOk = { ok: true; shivir: ShivirRef };

/**
 * The gate every scan path runs, whichever transport it arrived on.
 *
 * Denial is a 404, never a 403: revealing that a shivir exists to someone
 * outside its city leaks which centres run which camps. The cross-city test
 * asserts this explicitly, including that no PII comes back with it.
 */
export async function assertShivirScanAccess(
  actor: User,
  shivirId: string,
): Promise<ShivirAccessOk | ShivirAccessDenied> {
  const shivir = await getShivir(shivirId);
  if (!shivir) {
    return { ok: false, code: "ERR_NOT_FOUND", message: "Shivir not found." };
  }
  if (!(await canActOnShivir(actor, shivir.city_id, shivirId))) {
    return { ok: false, code: "ERR_NOT_FOUND", message: "Shivir not found." };
  }
  return { ok: true, shivir };
}
