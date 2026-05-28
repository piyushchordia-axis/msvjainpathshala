/**
 * SyncOperationsRepository — typed access to `sync_operations` (SPEC §5.19).
 *
 * Idempotency design:
 *   - UNIQUE (user_id, client_op_id) ensures a replay is a database-level
 *     no-op, regardless of how many devices race.
 *   - `status` walks `processing → success | failed` per op. `duplicate` is
 *     reserved for wire-format only — it never lives on a row (a row that
 *     resolves a replay request is itself a `success` row whose payload we
 *     re-emit to the second caller).
 *   - `applied_at` is set on the SUCCESS-or-FAILED transition so the daily
 *     purge cron (TTL: 90 days, SPEC §5.19) can drop ancient rows.
 *
 * All writes flow through `db` (write pool); the existence-lookup uses the
 * write pool too because freshly-inserted `processing` rows must be visible
 * to concurrent batch calls without replica lag.
 */

import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { sync_operations } from '../schema';

import type { SyncOperation } from '../schema';
import type { SyncOpKind } from '@jp/shared';

@Injectable()
export class SyncOperationsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  /**
   * Bulk-lookup for the dedup pre-pass at the top of `applyBatch`. Returns
   * a map keyed by `client_op_id` so the service can decide per-op whether
   * to dispatch or replay.
   */
  async findByUserAndClientOpIds(
    userId: string,
    clientOpIds: string[],
  ): Promise<Map<string, SyncOperation>> {
    if (clientOpIds.length === 0) return new Map();
    const rows = await this.drizzle.db
      .select()
      .from(sync_operations)
      .where(
        and(
          eq(sync_operations.user_id, userId),
          inArray(sync_operations.client_op_id, clientOpIds),
        ),
      );
    const out = new Map<string, SyncOperation>();
    for (const r of rows) out.set(r.client_op_id, r);
    return out;
  }

  /**
   * Insert a `processing` row. ON CONFLICT DO NOTHING so a racing replay
   * from a second device gets `undefined` and falls through to a re-read.
   */
  async insertProcessing(input: {
    user_id: string;
    client_op_id: string;
    op_kind: SyncOpKind;
    request_payload: unknown;
  }): Promise<SyncOperation | null> {
    const [row] = await this.drizzle.db
      .insert(sync_operations)
      .values({
        user_id: input.user_id,
        client_op_id: input.client_op_id,
        op_kind: input.op_kind,
        request_payload: input.request_payload as Record<string, unknown>,
        status: 'processing',
      })
      .onConflictDoNothing({
        target: [sync_operations.user_id, sync_operations.client_op_id],
      })
      .returning();
    return row ?? null;
  }

  async markSucceeded(id: string, responsePayload: unknown): Promise<void> {
    await this.drizzle.db
      .update(sync_operations)
      .set({
        status: 'success',
        response_payload: responsePayload as Record<string, unknown>,
        applied_at: new Date(),
      })
      .where(eq(sync_operations.id, id));
  }

  async markFailed(id: string, errorCode: string, errorMessage: string): Promise<void> {
    await this.drizzle.db
      .update(sync_operations)
      .set({
        status: 'failed',
        error: `${errorCode}: ${errorMessage}`.slice(0, 4000),
        applied_at: new Date(),
      })
      .where(eq(sync_operations.id, id));
  }

  /**
   * Fallback path: after `insertProcessing` returns null (ON CONFLICT), the
   * service re-reads via this method to get the row that won the race.
   */
  async findOne(userId: string, clientOpId: string): Promise<SyncOperation | null> {
    const rows = await this.drizzle.db
      .select()
      .from(sync_operations)
      .where(and(eq(sync_operations.user_id, userId), eq(sync_operations.client_op_id, clientOpId)))
      .limit(1);
    return rows[0] ?? null;
  }
}
