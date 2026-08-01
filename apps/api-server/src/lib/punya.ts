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
   * Optional idempotency key. When supplied, awardPunya is exactly-once for that
   * key: a second call does NOT credit again and returns the already-awarded
   * result. Stored on punya_transactions.idempotency_key (unique when not null).
   *
   * Callers that already serialize/claim a row before awarding (niyam approval,
   * competition publish, quiz submit) don't need this — they guarantee
   * exactly-once upstream. It exists for entry points that have no natural row
   * to claim, e.g. the manual admin award.
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

const SUBMISSION_ID_RE =
  /^submission:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::|$)/i;

/** Best-effort parse of source entity fields from feature + idempotency key. */
function sourceFromKey(
  featureKey: string,
  idempotencyKey: string | null,
): { kind: string | null; id: string | null } {
  if (!idempotencyKey) return { kind: featureKey || null, id: null };
  const m = SUBMISSION_ID_RE.exec(idempotencyKey);
  if (m) return { kind: featureKey || "niyam_submission", id: m[1]! };
  return { kind: featureKey || null, id: null };
}

async function readBalance(tx: Tx | Db, studentId: string, fallbackPoints: number) {
  const [bal] = await tx
    .select({ total_points: punya_balances.total_points })
    .from(punya_balances)
    .where(eq(punya_balances.student_id, studentId))
    .limit(1);
  const total = bal?.total_points ?? fallbackPoints;
  return total;
}

async function creditBalance(tx: Tx | Db, studentId: string, delta: number): Promise<number> {
  const result = await tx.execute(
    sql`insert into punya_balances (student_id, total_points)
        values (${studentId}, ${delta})
        on conflict (student_id) do update
          set total_points = punya_balances.total_points + ${delta}
        returning total_points`,
  );
  const rows = (result as unknown as { rows?: Array<{ total_points: number }> }).rows ?? [];
  const total = Number(rows[0]?.total_points ?? delta);
  await tx
    .update(punya_balances)
    .set({ tier: tierForPoints(total) })
    .where(eq(punya_balances.student_id, studentId));
  return total;
}

/**
 * Core award, run inside a caller-supplied transaction so the ledger insert,
 * balance upsert, and tier recompute all commit (or roll back) together with
 * whatever else the caller is doing in the same `tx`.
 */
async function runAward(tx: Tx | Db, input: AwardPunyaInput): Promise<AwardPunyaResult> {
  const key = input.idempotencyKey?.trim() || null;
  const source = sourceFromKey(input.featureKey, key);

  if (key) {
    // Partial unique index on idempotency_key — ON CONFLICT DO NOTHING.
    const insertResult = await tx.execute(sql`
      insert into punya_transactions (
        student_id, feature_key, points, note, awarded_by,
        idempotency_key, source_entity_kind, source_entity_id
      ) values (
        ${input.studentId}, ${input.featureKey}, ${input.points},
        ${input.note ?? null}, ${input.awardedBy ?? null},
        ${key}, ${source.kind}, ${source.id}
      )
      on conflict (idempotency_key) where idempotency_key is not null
      do nothing
      returning points
    `);
    const inserted =
      (insertResult as unknown as { rows?: Array<{ points: number }> }).rows ?? [];
    if (inserted.length === 0) {
      const [existing] = await tx
        .select({ points: punya_transactions.points })
        .from(punya_transactions)
        .where(eq(punya_transactions.idempotency_key, key))
        .limit(1);
      const total = await readBalance(tx, input.studentId, existing?.points ?? 0);
      return {
        student_id: input.studentId,
        points_awarded: existing?.points ?? input.points,
        total_points: total,
        tier: tierForPoints(total),
        awarded: false,
      };
    }
  } else {
    await tx.insert(punya_transactions).values({
      student_id: input.studentId,
      feature_key: input.featureKey,
      points: input.points,
      note: input.note ?? null,
      awarded_by: input.awardedBy ?? null,
      source_entity_kind: source.kind,
      source_entity_id: source.id,
    });
  }

  const total = await creditBalance(tx, input.studentId, input.points);
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
 */
export async function awardPunya(input: AwardPunyaInput, tx?: Tx): Promise<AwardPunyaResult> {
  if (tx) return runAward(tx, input);
  return db.transaction((t) => runAward(t, input));
}

export interface ReversePunyaInput {
  studentId: string;
  featureKey: string;
  /** Absolute points to claw back (positive number). */
  points: number;
  note?: string | null;
  awardedBy?: string | null;
  /**
   * Required. Stored on idempotency_key. A second reverse with the same key is
   * a no-op (does not double-debit).
   */
  idempotencyKey: string;
}

export interface ReversePunyaResult {
  student_id: string;
  points_reversed: number;
  total_points: number;
  tier: string;
  /** True when this call actually debited; false on idempotent replay. */
  reversed: boolean;
}

/** Strip a trailing `:reversal` suffix to find the original award key. */
function awardKeyFromReversal(key: string): string {
  return key.endsWith(":reversal") ? key.slice(0, -":reversal".length) : key;
}

async function runReverse(tx: Tx | Db, input: ReversePunyaInput): Promise<ReversePunyaResult> {
  const points = Math.abs(input.points);
  const key = input.idempotencyKey.trim();
  const originalKey = awardKeyFromReversal(key);

  const [original] = await tx
    .select({
      id: punya_transactions.id,
      source_entity_kind: punya_transactions.source_entity_kind,
      source_entity_id: punya_transactions.source_entity_id,
    })
    .from(punya_transactions)
    .where(
      and(
        eq(punya_transactions.student_id, input.studentId),
        eq(punya_transactions.idempotency_key, originalKey),
      ),
    )
    .limit(1);

  const sourceKind = original?.source_entity_kind ?? sourceFromKey(input.featureKey, originalKey).kind;
  const sourceId = original?.source_entity_id ?? sourceFromKey(input.featureKey, originalKey).id;
  const debit = -points;

  const insertResult = await tx.execute(sql`
    insert into punya_transactions (
      student_id, feature_key, points, note, awarded_by,
      idempotency_key, reversal_of, source_entity_kind, source_entity_id
    ) values (
      ${input.studentId}, ${input.featureKey}, ${debit},
      ${input.note ?? null}, ${input.awardedBy ?? null},
      ${key}, ${original?.id ?? null}, ${sourceKind}, ${sourceId}
    )
    on conflict (idempotency_key) where idempotency_key is not null
    do nothing
    returning points
  `);
  const inserted =
    (insertResult as unknown as { rows?: Array<{ points: number }> }).rows ?? [];

  if (inserted.length === 0) {
    const [existing] = await tx
      .select({ points: punya_transactions.points })
      .from(punya_transactions)
      .where(eq(punya_transactions.idempotency_key, key))
      .limit(1);
    const total = await readBalance(tx, input.studentId, 0);
    return {
      student_id: input.studentId,
      points_reversed: Math.abs(existing?.points ?? points),
      total_points: total,
      tier: tierForPoints(total),
      reversed: false,
    };
  }

  const total = await creditBalance(tx, input.studentId, debit);
  return {
    student_id: input.studentId,
    points_reversed: points,
    total_points: total,
    tier: tierForPoints(total),
    reversed: true,
  };
}

/** Claw back previously awarded Punya idempotently (negative ledger row). */
export async function reversePunya(input: ReversePunyaInput, tx?: Tx): Promise<ReversePunyaResult> {
  if (tx) return runReverse(tx, input);
  return db.transaction((t) => runReverse(t, input));
}
