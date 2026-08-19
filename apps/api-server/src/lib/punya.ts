/**
 * Shared Punya award logic. Inserts a transaction, upserts the student's
 * balance, and recomputes their tier. Used by manual award, niyam approval,
 * exam pass rewards, competitions, etc. — keep all point grants going through
 * this so balances/tiers never drift.
 */
import { db, punya_transactions, punya_balances } from "@workspace/db";
import {
  resolveTierThresholds,
  tierCaseSql,
  tierForPointsWith,
} from "./punya-tiers";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { resolvePunyaAwardContext } from "./punya-context";
import { notifyTierUpgrade } from "./punya-tier-notify";

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
  /**
   * When the child EARNED it, if that differs from now — an offline sync or
   * a catch-up job writes long after the fact. Defaults to now.
   */
  awardedAt?: Date | null;
}

export interface AwardPunyaResult {
  student_id: string;
  points_awarded: number;
  total_points: number;
  tier: string;
  /** Tier before this award, when known — drives the BRD 7.5 celebration. */
  previous_tier?: string | null;
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

export interface BalanceChange {
  total_points: number;
  tier: string;
  /**
   * The tier BEFORE this change, or null when the row did not exist yet.
   *
   * H4 — the old tier used to be unavailable by construction: this
   * statement computed the new tier in SQL and returned only total_points,
   * so nothing downstream could tell an upgrade from an ordinary award. No
   * celebration, no parent push, no certificate — not because they were
   * unimplemented, but because the information had already been discarded.
   */
  previous_tier: string | null;
}

/** Single balance-mutation path — always use RETURNING; skip no-ops.
 * PERF #10 step 4: upsert + tier in ONE statement. Thresholds from configuration (AT23).
 */
export async function creditBalance(
  tx: Tx | Db,
  studentId: string,
  delta: number,
  /**
   * How much of `delta` belongs to the MSV parallel track (M2). Reversals
   * pass a negative value, so msv_points nets off exactly like total_points
   * — otherwise the MSV leaderboard would keep counting clawed-back points.
   */
  msvDelta = 0,
): Promise<BalanceChange> {
  if (delta === 0) {
    const total = await readBalance(tx, studentId, 0);
    const tier = tierForPointsWith(total, await resolveTierThresholds());
    // A no-op cannot be a transition, so previous === current.
    return { total_points: total, tier, previous_tier: tier };
  }
  // AT23 — one configured ladder, one builder, three call sites.
  const thresholds = await resolveTierThresholds();
  const inserted = sql`${delta}`;
  const updated = sql`punya_balances.total_points + ${delta}`;
  const newTier = tierCaseSql(updated, thresholds);
  // `prev` is a CTE, so it reads the row as it stood BEFORE the upsert in the
  // same snapshot — the only way to recover the pre-image without a second
  // round trip that another award could interleave with.
  const result = await tx.execute(
    sql`with prev as (
          select tier::text as tier from punya_balances where student_id = ${studentId}
        ),
        upserted as (
          insert into punya_balances (student_id, total_points, tier, msv_points, tier_reached_at)
          values (
            ${studentId}, ${delta}, ${tierCaseSql(inserted, thresholds)}, ${msvDelta}, now()
          )
          on conflict (student_id) do update
            set total_points = punya_balances.total_points + ${delta},
                msv_points = punya_balances.msv_points + ${msvDelta},
                tier = ${newTier},
                tier_reached_at = case
                  when ${newTier} is distinct from punya_balances.tier then now()
                  else punya_balances.tier_reached_at
                end,
                updated_at = now()
          returning total_points, tier::text as tier
        )
        select u.total_points, u.tier, p.tier as previous_tier
        from upserted u left join prev p on true`,
  );
  const rows =
    (result as unknown as {
      rows?: Array<{ total_points: number; tier: string; previous_tier: string | null }>;
    }).rows ?? [];
  const row = rows[0];
  return {
    total_points: Number(row?.total_points ?? delta),
    tier: row?.tier ?? tierForPointsWith(delta, thresholds),
    // No prior row means the student had ZERO points, and zero points is a
    // real tier — not unknown. Reporting null here made a child whose very
    // first award vaulted them past a threshold silently not a crossing, so
    // the one moment most worth celebrating was the one that went unnoticed.
    previous_tier: row?.previous_tier ?? tierForPointsWith(0, thresholds),
  };
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

  // M2 — the MSV share of each delta, so msv_points tracks the bulk
  // attendance path too. Contexts are cached, so a whole roster on one batch
  // costs one lookup rather than one per child.
  const msvDeltas: number[] = [];
  for (const id of ids) {
    const ctx = await resolvePunyaAwardContext(id);
    msvDeltas.push(ctx.is_msv_track ? byStudent.get(id)! : 0);
  }
  const msvArray = sql`array[${sql.join(
    msvDeltas.map((d) => sql`${d}::int`),
    sql`, `,
  )}]::int[]`;

  const thresholds = await resolveTierThresholds();
  const fresh = sql`s.delta`;
  const combined = sql`punya_balances.total_points + excluded.total_points`;

  await tx.execute(sql`
    insert into punya_balances (student_id, total_points, tier, msv_points)
    select s.student_id, s.delta, ${tierCaseSql(fresh, thresholds)}, s.msv_delta
    from unnest(${idArray}, ${deltaArray}, ${msvArray})
      as s(student_id, delta, msv_delta)
    on conflict (student_id) do update
      set total_points = punya_balances.total_points + excluded.total_points,
          msv_points = punya_balances.msv_points + excluded.msv_points,
          tier = ${tierCaseSql(combined, thresholds)},
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

  // M1 — geography and MSV membership snapshotted onto the row. Resolved
  // once here so both insert branches agree, and cached so an attendance
  // roster does not re-resolve the same batch for every child.
  const ctx = await resolvePunyaAwardContext(input.studentId);
  const awardedAt = input.awardedAt ?? new Date();

  if (key) {
    // Partial unique index on idempotency_key — ON CONFLICT DO NOTHING.
    const insertResult = await tx.execute(sql`
      insert into punya_transactions (
        student_id, feature_key, points, note, awarded_by,
        idempotency_key, source_entity_kind, source_entity_id, source_revision,
        city_id, centre_id, batch_id, is_msv_track, awarded_at
      ) values (
        ${input.studentId}, ${input.featureKey}, ${input.points},
        ${input.note ?? null}, ${input.awardedBy ?? null},
        ${key}, ${sourceKind}, ${sourceId}, ${sourceRevision},
        ${ctx.city_id}, ${ctx.centre_id}, ${ctx.batch_id}, ${ctx.is_msv_track},
        ${awardedAt}
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
        tier: tierForPointsWith(total, await resolveTierThresholds()),
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
        city_id: ctx.city_id,
        centre_id: ctx.centre_id,
        batch_id: ctx.batch_id,
        is_msv_track: ctx.is_msv_track,
        awarded_at: awardedAt,
      })
      .returning({ id: punya_transactions.id });
    transactionId = row?.id ?? null;
  }

  const change = await creditBalance(
    tx,
    input.studentId,
    input.points,
    ctx.is_msv_track ? input.points : 0,
  );
  return {
    student_id: input.studentId,
    points_awarded: input.points,
    total_points: change.total_points,
    tier: change.tier,
    previous_tier: change.previous_tier,
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
 *
 * H4: the tier-upgrade push fires only on the OWN-transaction path, because
 * only there do we know the award has actually committed. A composed caller
 * owns its own commit, so it gets `previous_tier` on the result and emits
 * after committing — telling a family their child reached Sadhak and then
 * rolling the award back would be worse than a late notification.
 */
export async function awardPunya(input: AwardPunyaInput, tx?: Tx): Promise<AwardPunyaResult> {
  if (tx) return runAward(tx, input);
  const result = await db.transaction((t) => runAward(t, input));
  if (result.awarded) {
    await notifyTierUpgrade({
      studentId: result.student_id,
      previousTier: result.previous_tier,
      newTier: result.tier,
      totalPoints: result.total_points,
    });
  }
  return result;
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
  /** Tier before this reversal, when known. */
  previous_tier?: string | null;
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
        tier: tierForPointsWith(total, await resolveTierThresholds()),
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

  // A reversal inherits the award's geography and MSV flag. Written without
  // them, the debit would not net off in any scoped or MSV leaderboard and
  // clawed-back points would go on counting forever.
  const revCtx = await resolvePunyaAwardContext(input.studentId);
  const insertResult = await tx.execute(sql`
    insert into punya_transactions (
      student_id, feature_key, points, note, awarded_by,
      idempotency_key, reversal_of, source_entity_kind, source_entity_id,
      city_id, centre_id, batch_id, is_msv_track, awarded_at
    ) values (
      ${input.studentId}, ${input.featureKey}, ${debit},
      ${input.note ?? null}, ${input.awardedBy ?? null},
      ${key}, ${original?.id ?? null}, ${sourceKind}, ${sourceId},
      ${revCtx.city_id}, ${revCtx.centre_id}, ${revCtx.batch_id},
      ${revCtx.is_msv_track}, ${new Date()}
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
      tier: tierForPointsWith(total, await resolveTierThresholds()),
      reversed: false,
      transaction_id: existing?.id ?? null,
    };
  }

  const change = await creditBalance(
    tx,
    input.studentId,
    debit,
    revCtx.is_msv_track ? debit : 0,
  );
  return {
    student_id: input.studentId,
    points_reversed: points,
    total_points: change.total_points,
    tier: change.tier,
    previous_tier: change.previous_tier,
    reversed: true,
    transaction_id: inserted[0]!.id,
  };
}

/** Claw back previously awarded Punya idempotently (negative ledger row). */
export async function reversePunya(input: ReversePunyaInput, tx?: Tx): Promise<ReversePunyaResult> {
  if (tx) return runReverse(tx, input);
  return db.transaction((t) => runReverse(t, input));
}
