/**
 * ShikshakAssignmentsRepository — link table between shikshak users and the
 * batches they teach (`shikshak_batch_assignments`).
 *
 * `role_in_batch` is `'primary' | 'secondary'`. Step 6 only writes
 * `'primary'`; the secondary case lands in Step 8 when batches gain co-teach.
 */

import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { shikshak_batch_assignments } from '../schema';

import type { ShikshakBatchAssignment } from '../schema';

@Injectable()
export class ShikshakAssignmentsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  /** Active batch ids for a shikshak (populates ScopeContext). */
  async listBatchIdsForShikshak(shikshakUserId: string): Promise<string[]> {
    const rows = await this.drizzle.dbRead
      .select({ batch_id: shikshak_batch_assignments.batch_id })
      .from(shikshak_batch_assignments)
      .where(
        and(
          eq(shikshak_batch_assignments.shikshak_user_id, shikshakUserId),
          isNull(shikshak_batch_assignments.revoked_at),
        ),
      );
    return rows.map((r) => r.batch_id);
  }

  async listForBatch(batchId: string): Promise<ShikshakBatchAssignment[]> {
    return this.drizzle.dbRead
      .select()
      .from(shikshak_batch_assignments)
      .where(
        and(
          eq(shikshak_batch_assignments.batch_id, batchId),
          isNull(shikshak_batch_assignments.revoked_at),
        ),
      );
  }

  async assign(
    batchId: string,
    shikshakUserId: string,
    role: 'primary' | 'secondary' = 'primary',
  ): Promise<ShikshakBatchAssignment> {
    const [row] = await this.drizzle.db
      .insert(shikshak_batch_assignments)
      .values({
        batch_id: batchId,
        shikshak_user_id: shikshakUserId,
        role_in_batch: role,
        assigned_at: new Date(),
      })
      .returning();
    if (!row) throw new Error('[ShikshakAssignments.assign] insert returned no row');
    return row;
  }

  async revoke(batchId: string, shikshakUserId: string): Promise<void> {
    await this.drizzle.db
      .update(shikshak_batch_assignments)
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where(
        and(
          eq(shikshak_batch_assignments.batch_id, batchId),
          eq(shikshak_batch_assignments.shikshak_user_id, shikshakUserId),
          isNull(shikshak_batch_assignments.revoked_at),
        ),
      );
  }
}
