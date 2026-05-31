/**
 * HomeworkAssignmentsRepository — write/read helpers for
 * `homework_assignments` (SPEC §5.9).
 *
 * Soft-delete via `deleted_at` (handled by the `softDelete()` helper); we
 * never hard-delete. The shikshak UI list always excludes deleted rows.
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, lte } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { homework_assignments } from '../schema';

import type { HomeworkAssignment, NewHomeworkAssignment } from '../schema';

@Injectable()
export class HomeworkAssignmentsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findById(id: string): Promise<HomeworkAssignment | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(homework_assignments)
      .where(and(eq(homework_assignments.id, id), isNull(homework_assignments.deleted_at)))
      .limit(1);
    return rows[0] ?? null;
  }

  async insert(input: NewHomeworkAssignment): Promise<HomeworkAssignment> {
    const [row] = await this.drizzle.db.insert(homework_assignments).values(input).returning();
    if (!row) throw new Error('[HomeworkAssignments.insert] no row returned');
    return row;
  }

  async listForBatch(
    batchId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<HomeworkAssignment[]> {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    return this.drizzle.dbRead
      .select()
      .from(homework_assignments)
      .where(
        and(eq(homework_assignments.batch_id, batchId), isNull(homework_assignments.deleted_at)),
      )
      .orderBy(desc(homework_assignments.due_date))
      .limit(limit)
      .offset(offset);
  }

  async listForBatches(batchIds: string[]): Promise<HomeworkAssignment[]> {
    if (batchIds.length === 0) return [];
    return this.drizzle.dbRead
      .select()
      .from(homework_assignments)
      .where(
        and(
          inArray(homework_assignments.batch_id, batchIds),
          isNull(homework_assignments.deleted_at),
        ),
      )
      .orderBy(desc(homework_assignments.due_date));
  }

  /**
   * Find assignments past their due_date that still have pending submissions —
   * used by the late-homework cron processor.
   */
  async listOverdue(today: string): Promise<HomeworkAssignment[]> {
    return this.drizzle.dbRead
      .select()
      .from(homework_assignments)
      .where(
        and(lte(homework_assignments.due_date, today), isNull(homework_assignments.deleted_at)),
      );
  }

  async softDelete(id: string): Promise<HomeworkAssignment | null> {
    const [row] = await this.drizzle.db
      .update(homework_assignments)
      .set({ deleted_at: new Date(), updated_at: new Date() })
      .where(and(eq(homework_assignments.id, id), isNull(homework_assignments.deleted_at)))
      .returning();
    return row ?? null;
  }

  /** Recently-created assignments — used in tests/admin debugging. */
  async recentSince(since: Date, limit = 50): Promise<HomeworkAssignment[]> {
    return this.drizzle.dbRead
      .select()
      .from(homework_assignments)
      .where(
        and(gt(homework_assignments.created_at, since), isNull(homework_assignments.deleted_at)),
      )
      .orderBy(desc(homework_assignments.created_at))
      .limit(limit);
  }
}
