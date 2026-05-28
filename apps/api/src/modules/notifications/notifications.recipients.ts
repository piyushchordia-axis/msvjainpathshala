/**
 * RecipientResolver — turn a NotificationScope into a deduplicated list of
 * user_ids that should receive a fan-out.
 *
 * Each scope kind translates to a Drizzle query. All reads go through
 * `dbRead`. The resolver is intentionally *side-effect free* — it doesn't
 * touch the queue, the in-app feed, or audit logs. The fanout worker does.
 */

import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { type Role } from '@jp/shared';

import { DrizzleService } from '../../core/database/drizzle.service';
import {
  batches,
  centres,
  sanchalak_centre_assignments,
  shikshak_batch_assignments,
  students,
  users,
} from '../../db/schema';

import type { NotificationScope } from './notifications.types';

@Injectable()
export class RecipientResolver {
  constructor(private readonly drizzle: DrizzleService) {}

  /**
   * Resolve a scope to a list of `users.id` rows. Always deduplicated.
   * Returns an empty array on unknown scope (the fanout worker logs a
   * warning rather than throwing — a stale scope shouldn't crash the
   * pipeline).
   */
  async resolve(scope: NotificationScope): Promise<string[]> {
    switch (scope.kind) {
      case 'user':
        return scope.id ? [scope.id] : [];

      case 'batch':
        return scope.id ? this.recipientsForBatch(scope.id) : [];

      case 'centre':
        return scope.id ? this.recipientsForCentre(scope.id, scope.msv_only ?? false) : [];

      case 'city':
        return scope.id ? this.recipientsForCity(scope.id, scope.msv_only ?? false) : [];

      case 'state':
        return scope.id ? this.recipientsForState(scope.id) : [];

      case 'national':
        return this.recipientsForRoles(['super_admin', 'state_admin', 'city_admin']);

      case 'msv_cohort':
        return this.recipientsForMsvCohort();

      case 'role':
        return scope.role ? this.recipientsForRoles([scope.role as Role]) : [];

      default:
        return [];
    }
  }

  /** Parents + shikshak + sanchalak for everyone in a batch. */
  private async recipientsForBatch(batchId: string): Promise<string[]> {
    const out = new Set<string>();
    const parentRows = await this.drizzle.dbRead
      .select({ user_id: students.parent_user_id })
      .from(students)
      .where(and(eq(students.batch_id, batchId), eq(students.status, 'active')));
    for (const r of parentRows) out.add(r.user_id);

    const shikshakRows = await this.drizzle.dbRead
      .select({ user_id: shikshak_batch_assignments.shikshak_user_id })
      .from(shikshak_batch_assignments)
      .where(
        and(
          eq(shikshak_batch_assignments.batch_id, batchId),
          isNull(shikshak_batch_assignments.revoked_at),
        ),
      );
    for (const r of shikshakRows) out.add(r.user_id);

    // Centre's sanchalak too.
    const batch = await this.drizzle.dbRead
      .select({ centre_id: batches.centre_id })
      .from(batches)
      .where(eq(batches.id, batchId))
      .limit(1);
    const centreId = batch[0]?.centre_id;
    if (centreId) {
      const sanchalaks = await this.drizzle.dbRead
        .select({ user_id: sanchalak_centre_assignments.sanchalak_user_id })
        .from(sanchalak_centre_assignments)
        .where(
          and(
            eq(sanchalak_centre_assignments.centre_id, centreId),
            isNull(sanchalak_centre_assignments.revoked_at),
          ),
        );
      for (const r of sanchalaks) out.add(r.user_id);
    }
    return Array.from(out);
  }

  /** Parents (+ optionally only MSV) + shikshaks + sanchalaks of a centre. */
  private async recipientsForCentre(centreId: string, msvOnly: boolean): Promise<string[]> {
    const out = new Set<string>();
    const studentFilters = [eq(students.centre_id, centreId), eq(students.status, 'active')];
    if (msvOnly) {
      studentFilters.push(eq(students.msv_status, 'approved'));
    }
    const parentRows = await this.drizzle.dbRead
      .select({ user_id: students.parent_user_id })
      .from(students)
      .where(and(...studentFilters));
    for (const r of parentRows) out.add(r.user_id);

    const sanchalaks = await this.drizzle.dbRead
      .select({ user_id: sanchalak_centre_assignments.sanchalak_user_id })
      .from(sanchalak_centre_assignments)
      .where(
        and(
          eq(sanchalak_centre_assignments.centre_id, centreId),
          isNull(sanchalak_centre_assignments.revoked_at),
        ),
      );
    for (const r of sanchalaks) out.add(r.user_id);

    // Shikshaks of any batch in this centre.
    const batchRows = await this.drizzle.dbRead
      .select({ id: batches.id })
      .from(batches)
      .where(eq(batches.centre_id, centreId));
    if (batchRows.length > 0) {
      const shikshakRows = await this.drizzle.dbRead
        .select({ user_id: shikshak_batch_assignments.shikshak_user_id })
        .from(shikshak_batch_assignments)
        .where(
          and(
            inArray(
              shikshak_batch_assignments.batch_id,
              batchRows.map((b) => b.id),
            ),
            isNull(shikshak_batch_assignments.revoked_at),
          ),
        );
      for (const r of shikshakRows) out.add(r.user_id);
    }

    return Array.from(out);
  }

  /** All users in a city. (Light implementation — full geo expansion lands later.) */
  private async recipientsForCity(cityId: string, msvOnly: boolean): Promise<string[]> {
    const out = new Set<string>();
    const studentFilters = [eq(students.status, 'active')];
    if (msvOnly) {
      studentFilters.push(eq(students.msv_status, 'approved'));
    }
    // Centres in this city.
    const centreRows = await this.drizzle.dbRead
      .select({ id: centres.id })
      .from(centres)
      .where(eq(centres.city_id, cityId));
    if (centreRows.length > 0) {
      const parentRows = await this.drizzle.dbRead
        .select({ user_id: students.parent_user_id })
        .from(students)
        .where(
          and(
            inArray(
              students.centre_id,
              centreRows.map((c) => c.id),
            ),
            ...studentFilters,
          ),
        );
      for (const r of parentRows) out.add(r.user_id);
    }
    // City admins (and above) pinned to this city.
    const adminRows = await this.drizzle.dbRead
      .select({ user_id: users.id })
      .from(users)
      .where(
        and(
          eq(users.city_id, cityId),
          inArray(users.role, ['city_admin', 'sanchalak', 'shikshak']),
          isNull(users.deleted_at),
        ),
      );
    for (const r of adminRows) out.add(r.user_id);
    return Array.from(out);
  }

  /** State-level: every user with this state_id. */
  private async recipientsForState(stateId: string): Promise<string[]> {
    const rows = await this.drizzle.dbRead
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.state_id, stateId), isNull(users.deleted_at)));
    return rows.map((r) => r.id);
  }

  private async recipientsForRoles(roles: Role[]): Promise<string[]> {
    if (roles.length === 0) return [];
    const rows = await this.drizzle.dbRead
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.role, roles), isNull(users.deleted_at)));
    return rows.map((r) => r.id);
  }

  private async recipientsForMsvCohort(): Promise<string[]> {
    const rows = await this.drizzle.dbRead
      .select({ user_id: students.parent_user_id })
      .from(students)
      .where(and(eq(students.msv_status, 'approved'), eq(students.status, 'active')));
    const set = new Set<string>();
    for (const r of rows) set.add(r.user_id);
    return Array.from(set);
  }
}
