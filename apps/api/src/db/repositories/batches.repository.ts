/**
 * BatchesRepository — thin typed query helpers for the `batches` table.
 *
 * Used by Step 6's enrolment service to check capacity, list batches by
 * centre / shikshak, and resolve a batch by id.
 */

import { Injectable } from '@nestjs/common';
import { and, count, eq, isNull } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { batches, shikshak_batch_assignments, students } from '../schema';

import type { Batch } from '../schema';

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
      .where(and(...filters));
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

  /**
   * Used by the enrolment-approval workflow (Step 6) — returns capacity,
   * current active-student count, and the difference.
   */
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
}
