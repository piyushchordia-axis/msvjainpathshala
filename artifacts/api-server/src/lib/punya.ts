/**
 * Shared Punya award logic. Inserts a transaction, upserts the student's
 * balance, and recomputes their tier. Used by manual award, niyam approval,
 * exam pass rewards, competitions, etc. — keep all point grants going through
 * this so balances/tiers never drift.
 */
import { db, punya_transactions, punya_balances } from "@workspace/db";
import { tierForPoints } from "@workspace/db/enums";
import { and, eq, sql } from "drizzle-orm";

export interface AwardPunyaInput {
  studentId: string;
  featureKey: string;
  points: number;
  note?: string | null;
  awardedBy?: string | null;
  /**
   * Optional idempotency key. When supplied, awardPunya is exactly-once for the
   * (studentId, featureKey, idempotencyKey) triple: a second call with the same
   * key does NOT credit again and instead returns the already-awarded result.
   *
   * Callers that already serialize/claim a row before awarding (niyam approval,
   * competition publish, quiz submit) don't need this — they guarantee
   * exactly-once upstream. It exists for entry points that have no natural row
   * to claim, e.g. the manual admin award, where a double-submit would
   * otherwise double-credit.
   *
   * NOTE: there is no dedicated idempotency column on punya_transactions, so the
   * key is persisted on the ledger row's `feature_key` as `<featureKey>#<key>`.
   * The lookup below matches that exact composite, and the row stores the same
   * composite, so the de-dupe is self-consistent without a schema change. The
   * `note` (user-facing) is left untouched.
   */
  idempotencyKey?: string | null;
}

export interface AwardPunyaResult {
  student_id: string;
  points_awarded: number;
  total_points: number;
  tier: string;
  /** True when this call actually credited; false when an idempotent replay. */
  awarded: boolean;
}

// The exact transaction-handle type drizzle hands to a `db.transaction(cb)`
// callback. Deriving it from `db.transaction` keeps it in lockstep with the
// configured driver/schema instead of hard-coding generic params.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db;

/**
 * Core award, run inside a caller-supplied transaction so the ledger insert,
 * balance upsert, and tier recompute all commit (or roll back) together with
 * whatever else the caller is doing in the same `tx`.
 */
async function runAward(tx: Tx | Db, input: AwardPunyaInput): Promise<AwardPunyaResult> {
  const key = input.idempotencyKey?.trim() || null;
  // Composite stored on the ledger row when an idempotency key is supplied.
  // Plain featureKey otherwise, so existing callers' rows are unchanged.
  const ledgerFeatureKey = key ? `${input.featureKey}#${key}` : input.featureKey;

  if (key) {
    // Serialize concurrent calls for this logical award so the existence check
    // below + the insert are atomic. Without the lock, two parallel double
    // submits would both miss the row and both credit. Lock is released on
    // commit/rollback of the surrounding transaction.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`punya:${input.studentId}:${ledgerFeatureKey}`}, 0))`,
    );
    const [existing] = await tx
      .select({ points: punya_transactions.points })
      .from(punya_transactions)
      .where(
        and(
          eq(punya_transactions.student_id, input.studentId),
          eq(punya_transactions.feature_key, ledgerFeatureKey),
        ),
      )
      .limit(1);
    if (existing) {
      // Idempotent replay: report the CURRENT balance, credit nothing.
      const [bal] = await tx
        .select({ total_points: punya_balances.total_points })
        .from(punya_balances)
        .where(eq(punya_balances.student_id, input.studentId))
        .limit(1);
      const total = bal?.total_points ?? existing.points;
      return {
        student_id: input.studentId,
        points_awarded: existing.points,
        total_points: total,
        tier: tierForPoints(total),
        awarded: false,
      };
    }
  }

  await tx.insert(punya_transactions).values({
    student_id: input.studentId,
    feature_key: ledgerFeatureKey,
    points: input.points,
    note: input.note ?? null,
    awarded_by: input.awardedBy ?? null,
  });
  const result = await tx.execute(
    sql`insert into punya_balances (student_id, total_points)
        values (${input.studentId}, ${input.points})
        on conflict (student_id) do update
          set total_points = punya_balances.total_points + ${input.points}
        returning total_points`,
  );
  const rows = (result as unknown as { rows?: Array<{ total_points: number }> }).rows ?? [];
  const total = Number(rows[0]?.total_points ?? input.points);
  await tx
    .update(punya_balances)
    .set({ tier: tierForPoints(total) })
    .where(eq(punya_balances.student_id, input.studentId));

  return {
    student_id: input.studentId,
    points_awarded: input.points,
    total_points: total,
    tier: tierForPoints(total),
    awarded: true,
  };
}

/**
 * Award Punya atomically.
 *
 * - Pass an existing `tx` to compose this award into a larger transaction (e.g.
 *   so a caller's row-claim + the award commit together).
 * - Omit `tx` to run in a fresh transaction of its own.
 *
 * All three writes (ledger insert + atomic balance upsert + tier) commit
 * together, so a crash can't leave the ledger and the cached balance out of
 * sync. The upsert increments in-DB on a UNIQUE(student_id) row, so concurrent
 * awards can't lose updates or create duplicate balance rows.
 */
export async function awardPunya(input: AwardPunyaInput, tx?: Tx): Promise<AwardPunyaResult> {
  if (tx) return runAward(tx, input);
  return db.transaction((t) => runAward(t, input));
}
