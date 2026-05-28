/**
 * PunyaTransactionsRepository — the financial-grade entry point into the
 * Punya ledger. Every Punya award flows through `insertWithBalanceUpdate`
 * so the ledger row, the maintained `punya_balances` projection, and the
 * idempotency-key guard all stay consistent.
 *
 *   • SPEC §5.7 + §8.5 — ledger + maintained balance, never-double-spend
 *   • CLAUDE.md "Common pitfalls → Awarding Punya without idempotency_key"
 *
 * Step 16 additions:
 *   - `insertWithBalanceUpdate` now recomputes `current_tier` from
 *     `tierForPoints()` and reports whether a tier upgrade fired (so the
 *     service can enqueue the celebration / certificate flow).
 *   - `reverseTransaction()` is the dedicated reversal entry point — writes
 *     a NEW row with negative `points` + `reversal_of` pointer, atomically
 *     decreases the balance, and returns the pre/post tier so callers can
 *     decide whether to recall a tier certificate.
 *   - `paginatedByStudent` + `findById` power the read APIs.
 *   - `reconcileBalances` is called by the nightly punya.reconcile worker.
 */

import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, lt, sql, sum } from 'drizzle-orm';

import { type Tier, TIERS, tierForPoints } from '@jp/shared';

import { DrizzleService } from '../../core/database/drizzle.service';
import { punya_balances, punya_transactions } from '../schema';

import type { NewPunyaTransaction, PunyaBalance, PunyaTransaction } from '../schema';

export interface InsertWithBalanceResult {
  /** The ledger row, either freshly inserted or replayed (idempotency hit). */
  transaction: PunyaTransaction;
  /** True if the input.idempotency_key already existed and we returned cached. */
  duplicate: boolean;
  /** Post-write balance for the student (null only on the duplicate=true path). */
  balance: PunyaBalance | null;
  /** Tier the student had BEFORE this txn — undefined on duplicate replays. */
  previous_tier?: Tier;
  /** Tier the student has AFTER this txn — undefined on duplicate replays. */
  new_tier?: Tier;
  /** True iff (previous_tier ≠ new_tier) AND new_tier > previous_tier. */
  tier_upgraded?: boolean;
}

export interface ReverseInput {
  /** The transaction being reversed. */
  source_id: string;
  /** Who issued the reversal (typically the admin in the request). */
  reversed_by_user_id: string;
  /** Free-text reason saved on the reversal row. */
  reason: string;
  /** The 30-day window key (Q5 / SPEC §8.5). */
  awarded_at: Date;
  /** New idempotency key for the reversal row itself. */
  idempotency_key: string;
}

export interface ReverseResult {
  reversal: PunyaTransaction;
  balance: PunyaBalance;
  previous_tier: Tier;
  new_tier: Tier;
  /** True iff the tier dropped (e.g. from sadhak → shravak). */
  tier_downgraded: boolean;
}

export interface ReconcileDriftRow {
  student_id: string;
  ledger_total: number;
  ledger_msv: number;
  projection_total: number;
  projection_msv: number;
  drift_total: number;
  drift_msv: number;
}

@Injectable()
export class PunyaTransactionsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  /**
   * Insert a ledger row + atomically update the maintained balance + recompute
   * the spiritual tier. Returns a rich result so callers know whether a tier
   * upgrade fired (which triggers the celebration push / certificate flow).
   *
   *   • `idempotency_key` UNIQUE: a duplicate insert returns the existing row
   *     WITHOUT touching the balance (cached-result semantics).
   *   • Balance update is INSERT … ON CONFLICT … DO UPDATE so the first award
   *     for a student creates the balance row, subsequent awards accumulate.
   *   • `is_msv_track` rows also contribute to `msv_points`.
   *   • Tier is recomputed via tierForPoints() — the source of truth lives in
   *     @jp/shared so the API, mobile, and admin web never disagree.
   *   • Whole sequence runs inside a single transaction on the write pool.
   */
  async insertWithBalanceUpdate(input: NewPunyaTransaction): Promise<InsertWithBalanceResult> {
    return this.drizzle.transaction(async (tx) => {
      // 1. Short-circuit on idempotency_key hit. We deliberately re-SELECT the
      //    row even though step 2 below uses ON CONFLICT DO NOTHING — the
      //    explicit read makes the duplicate-replay path return without
      //    touching the balance at all.
      const existing = await tx
        .select()
        .from(punya_transactions)
        .where(eq(punya_transactions.idempotency_key, input.idempotency_key))
        .limit(1);
      if (existing[0]) {
        return { transaction: existing[0], duplicate: true, balance: null };
      }

      // 2. Read the pre-write balance (if any) so we can compute the tier
      //    transition deterministically.
      const beforeRows = await tx
        .select()
        .from(punya_balances)
        .where(eq(punya_balances.student_id, input.student_id))
        .limit(1);
      const before: PunyaBalance | null = beforeRows[0] ?? null;
      const previousTier: Tier = before?.current_tier ?? 'jigyasu';
      const previousTotal = before?.total_points ?? 0;
      const newTotal = previousTotal + input.points;
      const newTier = tierForPoints(newTotal);

      // 3. Insert the ledger row. ON CONFLICT DO NOTHING handles the race
      //    where another caller inserted between our SELECT and now; we
      //    re-read in that case.
      const inserted = await tx
        .insert(punya_transactions)
        .values(input)
        .onConflictDoNothing({ target: punya_transactions.idempotency_key })
        .returning();

      let row: PunyaTransaction;
      let balance: PunyaBalance;
      if (inserted[0]) {
        row = inserted[0];

        // 4. UPSERT the maintained balance + tier in the same statement so
        //    racing callers see a consistent (total, tier) pair.
        const upserted = await tx
          .insert(punya_balances)
          .values({
            student_id: input.student_id,
            total_points: input.points,
            msv_points: input.is_msv_track ? input.points : 0,
            current_tier: tierForPoints(input.points),
            tier_reached_at: new Date(),
            last_updated_at: new Date(),
          })
          .onConflictDoUpdate({
            target: punya_balances.student_id,
            set: {
              total_points: sql`${punya_balances.total_points} + ${input.points}`,
              msv_points: input.is_msv_track
                ? sql`${punya_balances.msv_points} + ${input.points}`
                : punya_balances.msv_points,
              current_tier: newTier,
              tier_reached_at:
                newTier !== previousTier ? new Date() : punya_balances.tier_reached_at,
              last_updated_at: new Date(),
              updated_at: new Date(),
            },
          })
          .returning();
        balance = upserted[0]!;
      } else {
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
        // Re-read balance; in the race-replay path we treat this as a
        // duplicate and skip the upgrade signal.
        const afterRows = await tx
          .select()
          .from(punya_balances)
          .where(eq(punya_balances.student_id, input.student_id))
          .limit(1);
        return {
          transaction: row,
          duplicate: true,
          balance: afterRows[0] ?? null,
        };
      }

      return {
        transaction: row,
        duplicate: false,
        balance,
        previous_tier: previousTier,
        new_tier: newTier,
        tier_upgraded: tierRank(newTier) > tierRank(previousTier),
      };
    });
  }

  /**
   * Reverse a prior transaction.
   *
   *   - Writes a NEW row with negative `points` and `reversal_of` pointer.
   *   - Atomically decreases the balance (total and, if applicable, msv).
   *   - Recomputes the tier; returns whether it dropped.
   *
   * Caller is responsible for window checks (30 days per Q5) and for
   * verifying the source row exists + has `reversal_of IS NULL` before
   * calling. Service layer maps the various failure paths to AppError codes.
   */
  async reverseTransaction(input: ReverseInput): Promise<ReverseResult> {
    return this.drizzle.transaction(async (tx) => {
      const sourceRows = await tx
        .select()
        .from(punya_transactions)
        .where(eq(punya_transactions.id, input.source_id))
        .limit(1);
      const source = sourceRows[0];
      if (!source) {
        throw new Error(`[PunyaTransactions] cannot reverse: source ${input.source_id} not found`);
      }
      if (source.reversal_of != null) {
        throw new Error(
          `[PunyaTransactions] cannot reverse: source ${input.source_id} is itself a reversal`,
        );
      }
      // No double-reversal: scan for an existing reversal row pointing at it.
      const existingReversal = await tx
        .select()
        .from(punya_transactions)
        .where(eq(punya_transactions.reversal_of, source.id))
        .limit(1);
      if (existingReversal[0]) {
        throw new Error(`[PunyaTransactions] source ${input.source_id} already reversed`);
      }

      const reversalPoints = -source.points;

      const beforeRows = await tx
        .select()
        .from(punya_balances)
        .where(eq(punya_balances.student_id, source.student_id))
        .limit(1);
      const before = beforeRows[0];
      if (!before) {
        throw new Error(
          `[PunyaTransactions] cannot reverse: missing balance row for student=${source.student_id}`,
        );
      }
      const previousTier: Tier = before.current_tier;
      const newTotal = before.total_points + reversalPoints;
      const newTier = tierForPoints(newTotal);

      const reversalRows = await tx
        .insert(punya_transactions)
        .values({
          student_id: source.student_id,
          feature_key: source.feature_key,
          points: reversalPoints,
          reason: input.reason,
          awarded_by_user_id: input.reversed_by_user_id,
          source_entity_kind: source.source_entity_kind,
          source_entity_id: source.source_entity_id,
          reversal_of: source.id,
          is_msv_track: source.is_msv_track,
          awarded_at: input.awarded_at,
          city_id: source.city_id,
          centre_id: source.centre_id,
          batch_id: source.batch_id,
          idempotency_key: input.idempotency_key,
        })
        .returning();
      const reversal = reversalRows[0]!;

      const updated = await tx
        .update(punya_balances)
        .set({
          total_points: sql`${punya_balances.total_points} + ${reversalPoints}`,
          msv_points: source.is_msv_track
            ? sql`${punya_balances.msv_points} + ${reversalPoints}`
            : punya_balances.msv_points,
          current_tier: newTier,
          tier_reached_at: newTier !== previousTier ? new Date() : punya_balances.tier_reached_at,
          last_updated_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(punya_balances.student_id, source.student_id))
        .returning();

      return {
        reversal,
        balance: updated[0]!,
        previous_tier: previousTier,
        new_tier: newTier,
        tier_downgraded: tierRank(newTier) < tierRank(previousTier),
      };
    });
  }

  async findById(id: string): Promise<PunyaTransaction | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(punya_transactions)
      .where(eq(punya_transactions.id, id))
      .limit(1);
    return rows[0] ?? null;
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

  async balanceFor(studentId: string): Promise<PunyaBalance | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(punya_balances)
      .where(eq(punya_balances.student_id, studentId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Cursor-paged ledger feed for a single student. Returns one extra row
   * past the requested limit so the caller can emit `has_more`.
   */
  async paginatedByStudent(
    studentId: string,
    opts: { before?: Date; limit: number },
  ): Promise<PunyaTransaction[]> {
    const where = [eq(punya_transactions.student_id, studentId)];
    if (opts.before) where.push(lt(punya_transactions.awarded_at, opts.before));
    return this.drizzle.dbRead
      .select()
      .from(punya_transactions)
      .where(and(...where))
      .orderBy(desc(punya_transactions.awarded_at))
      .limit(opts.limit + 1);
  }

  /**
   * Total count of ledger rows for a student (used by the audit page).
   */
  async countByStudent(studentId: string): Promise<number> {
    const rows = await this.drizzle.dbRead
      .select({ c: count() })
      .from(punya_transactions)
      .where(eq(punya_transactions.student_id, studentId));
    return Number(rows[0]?.c ?? 0);
  }

  /**
   * Compare every projection row to the sum of its ledger entries and return
   * the rows where they disagree. The nightly punya.reconcile job calls this
   * and runs the repair via `repairBalance()` per drift row.
   */
  async detectBalanceDrift(): Promise<ReconcileDriftRow[]> {
    const sumExpr = sql<string>`COALESCE(SUM(${punya_transactions.points}), 0)`;
    const msvSumExpr = sql<string>`COALESCE(SUM(${punya_transactions.points})
      FILTER (WHERE ${punya_transactions.is_msv_track} = true), 0)`;
    const totalsRows = await this.drizzle.dbRead
      .select({
        student_id: punya_transactions.student_id,
        ledger_total: sumExpr,
        ledger_msv: msvSumExpr,
      })
      .from(punya_transactions)
      .groupBy(punya_transactions.student_id);
    const totals = new Map<string, { total: number; msv: number }>();
    for (const r of totalsRows) {
      totals.set(r.student_id, {
        total: Number(r.ledger_total),
        msv: Number(r.ledger_msv),
      });
    }

    const balanceRows = await this.drizzle.dbRead.select().from(punya_balances);
    const drift: ReconcileDriftRow[] = [];
    for (const b of balanceRows) {
      const t = totals.get(b.student_id) ?? { total: 0, msv: 0 };
      if (b.total_points !== t.total || b.msv_points !== t.msv) {
        drift.push({
          student_id: b.student_id,
          ledger_total: t.total,
          ledger_msv: t.msv,
          projection_total: b.total_points,
          projection_msv: b.msv_points,
          drift_total: b.total_points - t.total,
          drift_msv: b.msv_points - t.msv,
        });
      }
      totals.delete(b.student_id);
    }
    // Ledger rows with no balance entry — backfill these too.
    for (const [studentId, t] of totals.entries()) {
      drift.push({
        student_id: studentId,
        ledger_total: t.total,
        ledger_msv: t.msv,
        projection_total: 0,
        projection_msv: 0,
        drift_total: -t.total,
        drift_msv: -t.msv,
      });
    }
    return drift;
  }

  /**
   * Repair one student's balance projection by rewriting it from the ledger.
   * Used by the nightly reconcile cron and by the admin "Run reconcile now"
   * button on the audit page.
   */
  async repairBalance(studentId: string): Promise<PunyaBalance> {
    return this.drizzle.transaction(async (tx) => {
      const sumRow = await tx
        .select({
          total: sql<string>`COALESCE(SUM(${punya_transactions.points}), 0)`,
          msv: sql<string>`COALESCE(SUM(${punya_transactions.points})
            FILTER (WHERE ${punya_transactions.is_msv_track} = true), 0)`,
        })
        .from(punya_transactions)
        .where(eq(punya_transactions.student_id, studentId));
      const total = Number(sumRow[0]?.total ?? 0);
      const msv = Number(sumRow[0]?.msv ?? 0);
      const tier = tierForPoints(total);

      const upserted = await tx
        .insert(punya_balances)
        .values({
          student_id: studentId,
          total_points: total,
          msv_points: msv,
          current_tier: tier,
          tier_reached_at: new Date(),
          last_updated_at: new Date(),
        })
        .onConflictDoUpdate({
          target: punya_balances.student_id,
          set: {
            total_points: total,
            msv_points: msv,
            current_tier: tier,
            tier_reached_at: new Date(),
            last_updated_at: new Date(),
            updated_at: new Date(),
          },
        })
        .returning();
      return upserted[0]!;
    });
  }

  /**
   * Sum points awarded since `since` per student, scoped to a given filter.
   * Powers the leaderboard ZSET refresh — one query per scope.
   */
  async sumByStudentSince(opts: {
    since: Date;
    filter: { batch_id?: string; centre_id?: string; city_id?: string; msv_only?: boolean };
  }): Promise<Array<{ student_id: string; points: number }>> {
    const where = [gt(punya_transactions.awarded_at, opts.since)];
    if (opts.filter.batch_id) where.push(eq(punya_transactions.batch_id, opts.filter.batch_id));
    if (opts.filter.centre_id) where.push(eq(punya_transactions.centre_id, opts.filter.centre_id));
    if (opts.filter.city_id) where.push(eq(punya_transactions.city_id, opts.filter.city_id));
    if (opts.filter.msv_only) where.push(eq(punya_transactions.is_msv_track, true));

    const rows = await this.drizzle.dbRead
      .select({
        student_id: punya_transactions.student_id,
        points: sum(punya_transactions.points).as('points'),
      })
      .from(punya_transactions)
      .where(and(...where))
      .groupBy(punya_transactions.student_id);
    return rows.map((r) => ({ student_id: r.student_id, points: Number(r.points ?? 0) }));
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Index of `tier` in the canonical TIERS list — higher = more advanced. */
function tierRank(tier: Tier): number {
  return TIERS.indexOf(tier);
}
