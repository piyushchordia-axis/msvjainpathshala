/**
 * punya.reconcile — rebuild balances from the ledger, and say so when they were wrong.
 *
 * H3. The previous implementation was one INSERT … SELECT … ON CONFLICT DO UPDATE
 * and had four defects:
 *
 *  1. It hardcoded 'jigyasu' on insert and omitted `tier` from the DO UPDATE, so a
 *     Tirthankar whose points were restored to 6,200 kept tier='jigyasu' forever.
 *     Tier is the emotional payload of the whole module; silently wrong is worse
 *     than absent.
 *  2. `GROUP BY student_id` over punya_transactions cannot produce a row for a
 *     student who has a balance but no ledger rows, so the exact corruption most
 *     worth catching — a balance conjured from nowhere — was unreachable.
 *  3. It compared nothing. There was no log, no count, no notification: the job
 *     that exists to detect corruption reported success identically whether it
 *     had fixed ten thousand rows or none. Step 16's exit criterion is
 *     "restores correctness AND alerts ops".
 *  4. It SET the balance from a sum taken in the same statement's snapshot. An
 *     award committing concurrently has its ledger row and its balance delta
 *     commit together, but if that commit lands after this statement's snapshot,
 *     the write here erases the delta while keeping the row — so the job could
 *     CREATE the drift it exists to remove.
 *
 * Shape now: one cheap read-only scan to find candidates, then a per-student
 * transactional repair that locks the balance row and re-sums that student's
 * ledger under the lock. (4) cannot happen, because creditBalance's upsert
 * contends on the same row. The volume is small — only drifting students reach
 * phase two — so the lock is held briefly and only where it matters.
 */
import { db, dbWorker, punya_balances } from "@workspace/db";
import { resolveTierThresholds, tierCaseSql } from "../lib/punya-tiers";
import { eq, sql, type SQL } from "drizzle-orm";
import { logger } from "../lib/logger";
import { notifyUsers } from "../lib/notify";

export interface PunyaDriftRow {
  student_id: string;
  balance_total: number | null;
  ledger_total: number;
  balance_tier: string | null;
  ledger_tier: string;
  /** True when a balance row exists with no ledger rows behind it at all. */
  orphan_balance: boolean;
}

export interface PunyaReconcileResult {
  scanned: number;
  drifted: number;
  repaired: number;
  orphanBalances: number;
  /** Net points moved across all repairs — a large number is a real incident. */
  netPointsMoved: number;
  samples: PunyaDriftRow[];
}

// AT23 — the ladder comes from lib/punya-tiers, the same builder
// creditBalance uses. Three hand-rolled copies of these five numbers used to
// exist with nothing asserting they agreed.

/**
 * Phase one: every student whose stored balance or tier disagrees with the ledger.
 * Read-only, so it is safe to run on the worker pool against the full table.
 */
async function findDrift(): Promise<{ scanned: number; rows: PunyaDriftRow[] }> {
  const thresholds = await resolveTierThresholds();
  const ledgerTotal = sql`coalesce(l.total, 0)`;
  const result = await dbWorker.execute(sql`
    with ledger as (
      select student_id, coalesce(sum(points), 0)::int as total
      from punya_transactions
      group by student_id
    ),
    joined as (
      -- FULL OUTER JOIN, not GROUP BY: reaches balances with no ledger behind them.
      select
        coalesce(l.student_id, b.student_id) as student_id,
        ${ledgerTotal}::int as ledger_total,
        b.total_points as balance_total,
        b.tier::text as balance_tier,
        (l.student_id is null) as orphan_balance,
        ${tierCaseSql(ledgerTotal, thresholds)}::text as ledger_tier
      from ledger l
      full outer join punya_balances b on b.student_id = l.student_id
    ),
    scanned as (select count(*)::int as n from joined)
    select
      j.student_id, j.ledger_total, j.balance_total, j.balance_tier,
      j.ledger_tier, j.orphan_balance, s.n as scanned_total
    from joined j cross join scanned s
    where j.balance_total is distinct from j.ledger_total
       or j.balance_tier is distinct from j.ledger_tier
    order by abs(coalesce(j.balance_total, 0) - j.ledger_total) desc
  `);
  const rows =
    (result as unknown as { rows?: Array<PunyaDriftRow & { scanned_total: number }> }).rows ?? [];
  // scanned_total is only carried on returned rows; with zero drift, count separately.
  let scanned = Number(rows[0]?.scanned_total ?? 0);
  if (rows.length === 0) {
    const c = await dbWorker.execute(sql`
      select count(*)::int as n from (
        select student_id from punya_transactions group by student_id
        union
        select student_id from punya_balances
      ) t
    `);
    scanned = Number((c as unknown as { rows?: Array<{ n: number }> }).rows?.[0]?.n ?? 0);
  }
  return {
    scanned,
    rows: rows.map((r) => ({
      student_id: r.student_id,
      balance_total: r.balance_total == null ? null : Number(r.balance_total),
      ledger_total: Number(r.ledger_total),
      balance_tier: r.balance_tier,
      ledger_tier: r.ledger_tier,
      orphan_balance: Boolean(r.orphan_balance),
    })),
  };
}

/**
 * Phase two: repair one student under a row lock, re-reading the ledger inside
 * the lock so a concurrently committing award is either fully counted or blocks.
 * Returns the points actually moved (0 when the candidate turned out to be stale).
 */
async function repairStudent(studentId: string): Promise<number> {
  const thresholds = await resolveTierThresholds();
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ total_points: punya_balances.total_points })
      .from(punya_balances)
      .where(eq(punya_balances.student_id, studentId))
      .for("update")
      .limit(1);

    const totalExpr = sql`coalesce(sum(t.points), 0)`;
    const fresh = await tx.execute(sql`
      select ${totalExpr}::int as total, ${tierCaseSql(totalExpr, thresholds)}::text as tier
      from punya_transactions t
      where t.student_id = ${studentId}::uuid
    `);
    const row = (fresh as unknown as { rows?: Array<{ total: number; tier: string }> }).rows?.[0];
    const ledgerTotal = Number(row?.total ?? 0);
    const ledgerTier = row?.tier ?? "jigyasu";
    const before = locked?.total_points ?? null;

    await tx.execute(sql`
      insert into punya_balances (student_id, total_points, tier)
      values (${studentId}::uuid, ${ledgerTotal}, ${ledgerTier}::tier_enum)
      on conflict (student_id) do update
        set total_points = excluded.total_points,
            tier = excluded.tier,
            updated_at = now()
    `);
    return before == null ? ledgerTotal : ledgerTotal - before;
  });
}

/** Rebuild balances from the ledger; report and alert on any drift found. */
export async function reconcilePunyaBalances(): Promise<PunyaReconcileResult> {
  const { scanned, rows } = await findDrift();

  let repaired = 0;
  let netPointsMoved = 0;
  for (const row of rows) {
    const moved = await repairStudent(row.student_id);
    if (moved !== 0 || row.balance_tier !== row.ledger_tier) repaired++;
    netPointsMoved += moved;
  }

  const orphanBalances = rows.filter((r) => r.orphan_balance).length;
  const result: PunyaReconcileResult = {
    scanned,
    drifted: rows.length,
    repaired,
    orphanBalances,
    netPointsMoved,
    samples: rows.slice(0, 20),
  };

  if (rows.length === 0) {
    logger.info({ scanned }, "punya.reconcile — no drift");
    return result;
  }

  // Drift is never routine. Every award path is transactional and idempotent, so
  // a difference here means something wrote outside them.
  logger.error(
    {
      scanned,
      drifted: result.drifted,
      repaired: result.repaired,
      orphan_balances: orphanBalances,
      net_points_moved: netPointsMoved,
      samples: result.samples,
    },
    "punya.reconcile — balance drift detected and repaired",
  );
  await alertOps(result);
  return result;
}

/** Tell the people who can act on it. Never let a notification failure fail the job. */
async function alertOps(result: PunyaReconcileResult): Promise<void> {
  try {
    const admins = await db.execute(sql`
      select id from users where role = 'super_admin' and deleted_at is null
    `);
    const ids = ((admins as unknown as { rows?: Array<{ id: string }> }).rows ?? []).map(
      (r) => r.id,
    );
    if (ids.length === 0) return;
    const sign = result.netPointsMoved >= 0 ? "+" : "";
    const orphanNote =
      result.orphanBalances > 0 ? `, ${result.orphanBalances} with no ledger history` : "";
    await notifyUsers({
      userIds: ids,
      kind: "general",
      title_en: "Punya balance drift repaired",
      title_hi: "पुण्य संतुलन में अंतर ठीक किया गया",
      body_en:
        `${result.drifted} student balance(s) disagreed with the ledger and were rebuilt ` +
        `(${sign}${result.netPointsMoved} points net${orphanNote}). ` +
        `Check the punya.reconcile logs.`,
      body_hi:
        `${result.drifted} विद्यार्थियों का पुण्य संतुलन बहीखाते से मेल नहीं खाता था और उसे ठीक किया गया। ` +
        `कृपया punya.reconcile लॉग देखें।`,
    });
  } catch (err) {
    logger.error({ err }, "punya.reconcile — drift alert failed to send");
  }
}
