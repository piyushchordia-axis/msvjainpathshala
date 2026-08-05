import {
  db,
  centres,
  cities,
  sanchalak_centre_assignments,
  shikshak_centre_assignments,
  shikshak_batch_assignments,
  type User,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

export interface AdminScope {
  /** When null, the user can see every centre (super_admin). */
  centreIds: string[] | null;
  /**
   * Batch-level write scope.
   * - null: all batches inside centreIds (city+/sanchalak/super)
   * - string[]: only these batch ids (shikshak)
   */
  batchIds: string[] | null;
}

/**
 * Per-request memoization: the same User object (req.authUser / sync actor)
 * is reused across multiple resolveAdminScope calls in one request/batch.
 */
const scopeByUser = new WeakMap<User, Promise<AdminScope>>();

/**
 * Resolve centre + batch scope for an admin-panel user.
 * - super_admin: all centres / all batches
 * - state_admin: centres in their state
 * - city_admin: centres in their city
 * - sanchalak: assigned centres; all batches therein
 * - shikshak: tagged centres (read); assigned batches (write)
 */
export async function resolveAdminScope(user: User): Promise<AdminScope> {
  const cached = scopeByUser.get(user);
  if (cached) return cached;
  const pending = resolveAdminScopeUncached(user);
  scopeByUser.set(user, pending);
  try {
    return await pending;
  } catch (err) {
    scopeByUser.delete(user);
    throw err;
  }
}

async function resolveAdminScopeUncached(user: User): Promise<AdminScope> {
  switch (user.role) {
    case "super_admin":
      return { centreIds: null, batchIds: null };

    case "state_admin": {
      if (!user.state_id) return { centreIds: [], batchIds: [] };
      const rows = await db
        .select({ id: centres.id })
        .from(centres)
        .where(eq(centres.state_id, user.state_id));
      return { centreIds: rows.map((r) => r.id), batchIds: null };
    }

    case "city_admin": {
      if (!user.city_id) return { centreIds: [], batchIds: [] };
      const rows = await db
        .select({ id: centres.id })
        .from(centres)
        .where(eq(centres.city_id, user.city_id));
      return { centreIds: rows.map((r) => r.id), batchIds: null };
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
      return { centreIds: rows.map((r) => r.id), batchIds: null };
    }

    case "shikshak": {
      const [centreRows, batchRows] = await Promise.all([
        db
          .select({ id: shikshak_centre_assignments.centre_id })
          .from(shikshak_centre_assignments)
          .where(
            and(
              eq(shikshak_centre_assignments.user_id, user.id),
              eq(shikshak_centre_assignments.is_active, true),
            ),
          ),
        db
          .select({ id: shikshak_batch_assignments.batch_id })
          .from(shikshak_batch_assignments)
          .where(
            and(
              eq(shikshak_batch_assignments.user_id, user.id),
              eq(shikshak_batch_assignments.is_active, true),
            ),
          ),
      ]);
      return {
        centreIds: centreRows.map((r) => r.id),
        batchIds: batchRows.map((r) => r.id),
      };
    }

    default:
      return { centreIds: [], batchIds: [] };
  }
}
/** Centre-level read/write gate (roster, notices, centre staffing views). */
export function inCentreScope(scope: AdminScope, centreId: string | null | undefined): boolean {
  if (!centreId) return false;
  if (scope.centreIds === null) return true;
  return scope.centreIds.includes(centreId);
}

/**
 * Batch-level write gate (attendance, homework, batch mutations).
 * When batchIds is null, falls back to centre membership.
 */
export function inBatchWriteScope(
  scope: AdminScope,
  batchId: string | null | undefined,
  centreId: string | null | undefined,
): boolean {
  if (!batchId) return false;
  if (scope.batchIds === null) return inCentreScope(scope, centreId);
  return scope.batchIds.includes(batchId);
}

/** @deprecated Prefer inCentreScope — kept for gradual call-site migration. */
export function inScope(scope: AdminScope, centreId: string | null | undefined): boolean {
  return inCentreScope(scope, centreId);
}

/** Helper used to keep the `cities` import meaningful for state lookups elsewhere. */
export async function cityIdsForState(stateId: string): Promise<string[]> {
  const rows = await db.select({ id: cities.id }).from(cities).where(eq(cities.state_id, stateId));
  return rows.map((r) => r.id);
}

export { inArray };
