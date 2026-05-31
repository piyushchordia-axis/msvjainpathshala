import {
  db,
  centres,
  cities,
  sanchalak_centre_assignments,
  shikshak_batch_assignments,
  batches,
  type User,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

export interface AdminScope {
  /** When null, the user can see every centre (super_admin). */
  centreIds: string[] | null;
}

/**
 * Resolve the set of centre ids an admin-panel user may act on.
 * - super_admin: all centres (null sentinel)
 * - state_admin: centres in their state
 * - city_admin: centres in their city
 * - sanchalak: explicitly assigned centres
 * - shikshak: centres of batches they teach
 */
export async function resolveAdminScope(user: User): Promise<AdminScope> {
  switch (user.role) {
    case "super_admin":
      return { centreIds: null };

    case "state_admin": {
      if (!user.state_id) return { centreIds: [] };
      const rows = await db
        .select({ id: centres.id })
        .from(centres)
        .where(eq(centres.state_id, user.state_id));
      return { centreIds: rows.map((r) => r.id) };
    }

    case "city_admin": {
      if (!user.city_id) return { centreIds: [] };
      const rows = await db
        .select({ id: centres.id })
        .from(centres)
        .where(eq(centres.city_id, user.city_id));
      return { centreIds: rows.map((r) => r.id) };
    }

    case "sanchalak": {
      const rows = await db
        .select({ id: sanchalak_centre_assignments.centre_id })
        .from(sanchalak_centre_assignments)
        .where(
          and(
            eq(sanchalak_centre_assignments.user_id, user.id),
            eq(sanchalak_centre_assignments.is_active, true),
          ),
        );
      return { centreIds: rows.map((r) => r.id) };
    }

    case "shikshak": {
      const rows = await db
        .select({ centre_id: batches.centre_id })
        .from(shikshak_batch_assignments)
        .innerJoin(batches, eq(batches.id, shikshak_batch_assignments.batch_id))
        .where(
          and(
            eq(shikshak_batch_assignments.user_id, user.id),
            eq(shikshak_batch_assignments.is_active, true),
          ),
        );
      const ids = Array.from(new Set(rows.map((r) => r.centre_id)));
      return { centreIds: ids };
    }

    default:
      return { centreIds: [] };
  }
}

/** Helper used to keep the `cities` import meaningful for state lookups elsewhere. */
export async function cityIdsForState(stateId: string): Promise<string[]> {
  const rows = await db.select({ id: cities.id }).from(cities).where(eq(cities.state_id, stateId));
  return rows.map((r) => r.id);
}

export { inArray };
