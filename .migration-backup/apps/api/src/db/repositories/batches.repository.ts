/**
 * BatchesRepository — typed query helpers for the `batches` table.
 *
 * Step 4 shipped: findById, listByCentre, listByShikshak, assertCapacityRemaining.
 * Step 6 adds: scoped-list selectors, capacity-aware update, deactivate guards,
 * a resolver helper for ScopeGuard.
 */

import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { batches, centres, cities, shikshak_batch_assignments, students } from '../schema';

import type { Batch, NewBatch } from '../schema';

interface CapacityInfo {
  capacity: number;
  enrolled: number;
  remaining: number;
}

@Injectable()
export class BatchesRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findById(id: string): Promise<Batch | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(batches)
      .where(and(eq(batches.id, id), isNull(batches.deleted_at)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Used by ScopeGuard's BatchResolver. */
  async findScopeById(
    id: string,
  ): Promise<{ centre_id: string; city_id: string; state_id: string } | null> {
    const rows = await this.drizzle.dbRead
      .select({
        centre_id: batches.centre_id,
        city_id: centres.city_id,
        state_id: cities.state_id,
      })
      .from(batches)
      .innerJoin(centres, eq(centres.id, batches.centre_id))
      .innerJoin(cities, eq(cities.id, centres.city_id))
      .where(and(eq(batches.id, id), isNull(batches.deleted_at)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByCentre(
    centreId: string,
    opts?: { status?: 'active' | 'inactive' },
  ): Promise<Batch[]> {
    const filters = [eq(batches.centre_id, centreId), isNull(batches.deleted_at)];
    if (opts?.status) {
      filters.push(eq(batches.status, opts.status));
    }
    return this.drizzle.dbRead
      .select()
      .from(batches)
      .where(and(...filters))
      .orderBy(asc(batches.name));
  }

  /**
   * Batches the shikshak is assigned to via `shikshak_batch_assignments`.
   * The schema-side partial unique on `(shikshak_user_id, batch_id) WHERE
   * revoked_at IS NULL` (0002_indexes.sql) keeps the live set sane.
   */
  async listByShikshak(shikshakUserId: string): Promise<Batch[]> {
    return this.drizzle.dbRead
      .select({
        id: batches.id,
        centre_id: batches.centre_id,
        name: batches.name,
        day_of_week: batches.day_of_week,
        start_time: batches.start_time,
        end_time: batches.end_time,
        age_group: batches.age_group,
        shikshak_id: batches.shikshak_id,
        academic_year: batches.academic_year,
        status: batches.status,
        capacity: batches.capacity,
        language_preference: batches.language_preference,
        deleted_at: batches.deleted_at,
        created_at: batches.created_at,
        updated_at: batches.updated_at,
        created_by: batches.created_by,
        updated_by: batches.updated_by,
      })
      .from(batches)
      .innerJoin(shikshak_batch_assignments, eq(shikshak_batch_assignments.batch_id, batches.id))
      .where(
        and(
          eq(shikshak_batch_assignments.shikshak_user_id, shikshakUserId),
          isNull(shikshak_batch_assignments.revoked_at),
          isNull(batches.deleted_at),
        ),
      );
  }

  async create(input: NewBatch): Promise<Batch> {
    const [row] = await this.drizzle.db.insert(batches).values(input).returning();
    if (!row) throw new Error('[Batches.create] insert returned no row');
    return row;
  }

  async update(id: string, patch: Partial<NewBatch>): Promise<Batch> {
    const [row] = await this.drizzle.db
      .update(batches)
      .set({ ...patch, updated_at: new Date() })
      .where(eq(batches.id, id))
      .returning();
    if (!row) throw new Error('[Batches.update] update returned no row');
    return row;
  }

  async setStatus(id: string, status: 'active' | 'inactive'): Promise<void> {
    await this.drizzle.db
      .update(batches)
      .set({ status, updated_at: new Date() })
      .where(eq(batches.id, id));
  }

  /** Used by Step 6's enrolment service. */
  async assertCapacityRemaining(batchId: string): Promise<CapacityInfo> {
    const batch = await this.findById(batchId);
    if (!batch) {
      throw new Error(`Batch ${batchId} not found`);
    }
    const [{ value: enrolled } = { value: 0 }] = await this.drizzle.dbRead
      .select({ value: count() })
      .from(students)
      .where(and(eq(students.batch_id, batchId), eq(students.status, 'active')));
    return {
      capacity: batch.capacity,
      enrolled,
      remaining: batch.capacity - enrolled,
    };
  }

  /** Active student count alone — used by PATCH guards in Step 6. */
  async countActiveEnrolments(batchId: string): Promise<number> {
    const rows = await this.drizzle.dbRead
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(students)
      .where(and(eq(students.batch_id, batchId), eq(students.status, 'active')));
    return rows[0]?.c ?? 0;
  }
}
