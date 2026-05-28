/**
 * PunyaTransactionsRepository — the financial-grade entry point into the
 * Punya ledger. Every Punya award flows through `insertWithBalanceUpdate`
 * so the ledger row, the maintained `punya_balances` projection, and the
 * idempotency-key guard all stay consistent.
 *
 *   • SPEC §5.7 + §8.5 — ledger + maintained balance, never-double-spend
 *   • CLAUDE.md "Common pitfalls → Awarding Punya without idempotency_key"
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { type DrizzleService } from '../../core/database/drizzle.service';
import { punya_balances, punya_transactions } from '../schema';

import type { NewPunyaTransaction, PunyaTransaction } from '../schema';

@Injectable()
export class PunyaTransactionsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  /**
   * Insert a ledger row + atomically update the maintained balance.
   *
   *   • `idempotency_key` UNIQUE: a duplicate insert returns the existing
   *     row WITHOUT touching the balance (cached-result semantics).
   *   • Balance update is INSERT … ON CONFLICT … DO UPDATE so the first
   *     award for a student creates the balance row, subsequent awards
   *     accumulate.
   *   • `is_msv_track` rows also contribute to `msv_points`.
   *   • Whole sequence runs inside a single transaction on the write pool.
   */
  async insertWithBalanceUpdate(input: NewPunyaTransaction): Promise<PunyaTransaction> {
    return this.drizzle.transaction(async (tx) => {
      // 1. Check for an existing row by idempotency_key first — short-circuit
      //    if the caller already won.
      const existing = await tx
        .select()
        .from(punya_transactions)
        .where(eq(punya_transactions.idempotency_key, input.idempotency_key))
        .limit(1);
      if (existing[0]) {
        return existing[0];
      }

      // 2. Insert the ledger row. `ON CONFLICT (idempotency_key)` could race
      //    us into the catch path — wrap it in DO NOTHING so the SELECT below
      //    finds whichever row landed.
      const inserted = await tx
        .insert(punya_transactions)
        .values(input)
        .onConflictDoNothing({ target: punya_transactions.idempotency_key })
        .returning();

      let row: PunyaTransaction;
      if (inserted[0]) {
        row = inserted[0];
        // 3. UPSERT the maintained balance.
        await tx
          .insert(punya_balances)
          .values({
            student_id: input.student_id,
            total_points: input.points,
            msv_points: input.is_msv_track ? input.points : 0,
            last_updated_at: new Date(),
          })
          .onConflictDoUpdate({
            target: punya_balances.student_id,
            set: {
              total_points: sql`${punya_balances.total_points} + ${input.points}`,
              msv_points: input.is_msv_track
                ? sql`${punya_balances.msv_points} + ${input.points}`
                : punya_balances.msv_points,
              last_updated_at: new Date(),
              updated_at: new Date(),
            },
          });
      } else {
        // Someone else won the race; fetch the row that landed.
        const winner = await tx
          .select()
          .from(punya_transactions)
          .where(eq(punya_transactions.idempotency_key, input.idempotency_key))
          .limit(1);
        if (!winner[0]) {
          throw new Error(
            `[PunyaTransactions] insert raced and the winning row could not be re-read for key=${input.idempotency_key}`,
          );
        }
        row = winner[0];
      }

      return row;
    });
  }

  async findByIdempotencyKey(key: string): Promise<PunyaTransaction | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(punya_transactions)
      .where(eq(punya_transactions.idempotency_key, key))
      .limit(1);
    return rows[0] ?? null;
  }

  async recentByStudent(studentId: string, limit: number): Promise<PunyaTransaction[]> {
    return this.drizzle.dbRead
      .select()
      .from(punya_transactions)
      .where(and(eq(punya_transactions.student_id, studentId)))
      .orderBy(desc(punya_transactions.awarded_at))
      .limit(limit);
  }
}
