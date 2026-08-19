/**
 * Shared Punya award logic. Inserts a transaction, upserts the student's
 * balance, and recomputes their tier. Used by manual award, niyam approval,
 * exam pass rewards, competitions, etc. — keep all point grants going through
 * this so balances/tiers never drift.
 */
import { db, punya_transactions, punya_balances } from "@workspace/db";
import { tierForPoints, TIER_THRESHOLDS } from "@workspace/db/enums";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "./logger";

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
  /** Override derived source fields (AT22 streak uses kind='attendance_streak'). */
  sourceEntityKind?: string | null;
  sourceEntityId?: string | null;
  /** Attendance / streak revision for deterministic reversal ordering. */
  sourceRevision?: number | null;
}

export interface AwardPunyaResult {
  student_id: string;
  points_awarded: number;
  total_points: number;
  tier: string;
  /** True when this call actually credited; false when an idempotent replay. */
  awarded: boolean;
  /** Ledger row id (null only if the insert path had no row to resolve). */
  transaction_id: string | null;
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

/** Single balance-mutation path — always use RETURNING; skip no-ops.
 * PERF #10 step 4: upsert + tier in ONE statement. Thresholds from TIER_THRESHOLDS (AT23).
 */
export async function creditBalance(
  tx: Tx | Db,
  studentId: string,
  delta: number,
): Promise<number> {
  if (delta === 0) {
    return readBalance(tx, studentId, 0);
  }
  const tTir = TIER_THRESHOLDS.tirthankar;
  const tShr = TIER_THRESHOLDS.shraman;
  const tSad = TIER_THRESHOLDS.sadhak;
  const tSra = TIER_THRESHOLDS.shravak;
  const result = await tx.execute(
    sql`insert into punya_balances (student_id, total_points, tier)
        values (
          ${studentId},
          ${delta},
          (case
            when ${delta} >= ${tTir} then 'tirthankar'::tier_enum
            when ${delta} >= ${tShr} then 'shraman'::tier_enum
            when ${delta} >= ${tSad} then 'sadhak'::tier_enum
            when ${delta} >= ${tSra} then 'shravak'::tier_enum
            else 'jigyasu'::tier_enum
          end)
        )
        on conflict (student_id) do update
          set total_points = punya_balances.total_points + ${delta},
              tier = (case
                when punya_balances.total_points + ${delta} >= ${tTir} then 'tirthankar'::tier_enum
                when punya_balances.total_points + ${delta} >= ${tShr} then 'shraman'::tier_enum
                when punya_balances.total_points + ${delta} >= ${tSad} then 'sadhak'::tier_enum
                when punya_balances.total_points + ${delta} >= ${tSra} then 'shravak'::tier_enum
                else 'jigyasu'::tier_enum
              end),
              updated_at = now()
        returning total_points`,
  );
  const rows = (result as unknown as { rows?: Array<{ total_points: number }> }).rows ?? [];
  return Number(rows[0]?.total_points ?? delta);
}

/**
 * PERF #10 step 5 — balance moves ONLY by SUM of returned (student_id, points) rows.
 * Never by attempted points.
 */
export async function creditBalancesFromReturned(
  tx: Tx | Db,
  returned: Array<{ student_id: string; points: number }>,
): Promise<void> {
  if (returned.length === 0) return;
  const byStudent = new Map<string, number>();
  for (const r of returned) {
    const pts = Number(r.points);
    if (pts === 0) continue;
    byStudent.set(r.student_id, (byStudent.get(r.student_id) ?? 0) + pts);
  }
  if (byStudent.size === 0) return;

  const ids = [...byStudent.keys()];
  const deltas = ids.map((id) => byStudent.get(id)!);
  const idArray = sql`array[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
  const deltaArray = sql`array[${sql.join(
    deltas.map((d) => sql`${d}::int`),
    sql`, `,
  )}]::int[]`;

  const tTir = TIER_THRESHOLDS.tirthankar;
  const tShr = TIER_THRESHOLDS.shraman;
  const tSad = TIER_THRESHOLDS.sadhak;
  const tSra = TIER_THRESHOLDS.shravak;

  await tx.execute(sql`
    insert into punya_balances (student_id, total_points, tier)
    select
      s.student_id,
      s.delta,
      (case
        when s.delta >= ${tTir} then 'tirthankar'::tier_enum
        when s.delta >= ${tShr} then 'shraman'::tier_enum
        when s.delta >= ${tSad} then 'sadhak'::tier_enum
        when s.delta >= ${tSra} then 'shravak'::tier_enum
        else 'jigyasu'::tier_enum
      end)
    from unnest(${idArray}, ${deltaArray}) as s(student_id, delta)
    on conflict (student_id) do update
      set total_points = punya_balances.total_points + excluded.total_points,
          tier = (case
            when punya_balances.total_points + excluded.total_points >= ${tTir} then 'tirthankar'::tier_enum
            when punya_balances.total_points + excluded.total_points >= ${tShr} then 'shraman'::tier_enum
            when punya_balances.total_points + excluded.total_points >= ${tSad} then 'sadhak'::tier_enum
            when punya_balances.total_points + excluded.total_points >= ${tSra} then 'shravak'::tier_enum
            else 'jigyasu'::tier_enum
          end),
          updated_at = now()
  `);
}

/**
 * Core award, run inside a caller-supplied transaction so the ledger insert,
 * balance upsert, and tier recompute all commit (or roll back) together with
 * whatever else the caller is doing in the same `tx`.
 */
async function runAward(tx: Tx | Db, input: AwardPunyaInput): Promise<AwardPunyaResult> {
  const key = input.idempotencyKey?.trim() || null;
  const derived = sourceFromKey(input.featureKey, key);
  const sourceKind = input.sourceEntityKind ?? derived.kind;
  const sourceId = input.sourceEntityId ?? derived.id;

  let transactionId: string | null = null;

  const sourceRevision = input.sourceRevision ?? null;

  if (key) {
    // Partial unique index on idempotency_key — ON CONFLICT DO NOTHING.
    const insertResult = await tx.execute(sql`
      insert into punya_transactions (
        student_id, feature_key, points, note, awarded_by,
        idempotency_key, source_entity_kind, source_entity_id, source_revision
      ) values (
        ${input.studentId}, ${input.featureKey}, ${input.points},
        ${input.note ?? null}, ${input.awardedBy ?? null},
        ${key}, ${sourceKind}, ${sourceId}, ${sourceRevision}
      )
      on conflict (idempotency_key) where idempotency_key is not null
      do nothing
      returning id, points
    `);
    const inserted =
      (insertResult as unknown as { rows?: Array<{ id: string; points: number }> }).rows ?? [];
    if (inserted.length === 0) {
      const [existing] = await tx
        .select({ id: punya_transactions.id, points: punya_transactions.points })
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
        transaction_id: existing?.id ?? null,
      };
    }
    transactionId = inserted[0]!.id;
  } else {
    const [row] = await tx
      .insert(punya_transactions)
      .values({
        student_id: input.studentId,
        feature_key: input.featureKey,
        points: input.points,
        note: input.note ?? null,
        awarded_by: input.awardedBy ?? null,
        source_entity_kind: sourceKind,
        source_entity_id: sourceId,
        source_revision: sourceRevision,
      })
      .returning({ id: punya_transactions.id });
    transactionId = row?.id ?? null;
  }

  const total = await creditBalance(tx, input.studentId, input.points);
  return {
    student_id: input.studentId,
    points_awarded: input.points,
    total_points: total,
    tier: tierForPoints(total),
    awarded: true,
    transaction_id: transactionId,
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
  /** Ledger row id for the reversal debit. */
  transaction_id: string | null;
}

/** Strip a trailing `:reversal` suffix to find the original award key. */
function awardKeyFromReversal(key: string): string {
  return key.endsWith(":reversal") ? key.slice(0, -":reversal".length) : key;
}

async function runReverse(tx: Tx | Db, input: ReversePunyaInput): Promise<ReversePunyaResult> {
  const key = input.idempotencyKey.trim();
  const originalKey = awardKeyFromReversal(key);

  const [original] = await tx
    .select({
      id: punya_transactions.id,
      points: punya_transactions.points,
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

  // M6 — the ledger is authoritative for the amount, not the caller.
  //
  // Every caller used to supply `points` itself. Most read it from the award
  // first, but niyam rejection passed niyam_submissions.points_awarded, a
  // denormalised copy: if it ever disagreed with the ledger row, the debit
  // silently moved the balance by the wrong amount and the reconcile then
  // rebuilt the balance around it.
  let points = Math.abs(input.points);
  if (original) {
    const ledgerPoints = Math.abs(Number(original.points));
    if (ledgerPoints !== points) {
      logger.warn(
        {
          student_id: input.studentId,
          idempotency_key: originalKey,
          caller_points: points,
          ledger_points: ledgerPoints,
        },
        "reversePunya — caller amount disagreed with the ledger; using the ledger",
      );
      points = ledgerPoints;
    }

    // Guard a second reversal that arrives under a DIFFERENT key. The
    // idempotency index only stops a replay of the same key, so two callers
    // with different key conventions could each debit the same award.
    const [already] = await tx
      .select({ id: punya_transactions.id })
      .from(punya_transactions)
      .where(eq(punya_transactions.reversal_of, original.id))
      .limit(1);
    if (already) {
      const total = await readBalance(tx, input.studentId, 0);
      return {
        student_id: input.studentId,
        points_reversed: 0,
        total_points: total,
        tier: tierForPoints(total),
        reversed: false,
        transaction_id: already.id,
      };
    }
  } else {
    // No matching award. Debiting anyway is still the lesser evil — a niyam
    // rejection that clawed back nothing would leave the child holding points
    // for a submission that was refused — but it is never routine, and the
    // resulting row has reversal_of = null, which nothing can later audit.
    logger.error(
      {
        student_id: input.studentId,
        idempotency_key: originalKey,
        feature_key: input.featureKey,
        points,
      },
      "reversePunya — no matching award found; writing an unlinked debit",
    );
  }

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
    returning id, points
  `);
  const inserted =
    (insertResult as unknown as { rows?: Array<{ id: string; points: number }> }).rows ?? [];

  if (inserted.length === 0) {
    const [existing] = await tx
      .select({ id: punya_transactions.id, points: punya_transactions.points })
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
      transaction_id: existing?.id ?? null,
    };
  }

  const total = await creditBalance(tx, input.studentId, debit);
  return {
    student_id: input.studentId,
    points_reversed: points,
    total_points: total,
    tier: tierForPoints(total),
    reversed: true,
    transaction_id: inserted[0]!.id,
  };
}

/** Claw back previously awarded Punya idempotently (negative ledger row). */
export async function reversePunya(input: ReversePunyaInput, tx?: Tx): Promise<ReversePunyaResult> {
  if (tx) return runReverse(tx, input);
  return db.transaction((t) => runReverse(t, input));
}
