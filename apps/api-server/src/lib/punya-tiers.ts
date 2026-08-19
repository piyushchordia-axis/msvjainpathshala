/**
 * AT23 — the Punya tier ladder, resolved from configuration.
 *
 * "Punya tiers: Jigyasu 0–100, Shravak 101–500, Sadhak 501–1500, Shraman
 * 1501–5000, Tirthankar 5001+. These live in CONFIGURATION alongside
 * punya_features, not as code constants — adjustable without a migration."
 *
 * They were `TIER_THRESHOLDS` in enums.ts, so every adjustment needed a deploy,
 * and the same five numbers were re-inlined into three separate SQL CASE
 * ladders — creditBalance, creditBalancesFromReturned and punya.reconcile —
 * with nothing asserting the three agreed with each other or with
 * tierForPoints. One source now feeds all of them.
 *
 * The constant survives as the cold-start fallback, exactly as every points
 * resolver keeps a hardcoded floor: a tier is on every family-facing screen, so
 * an unreachable config table must degrade to the documented ladder rather than
 * collapse everyone to Jigyasu.
 */
import { db, punya_tier_thresholds } from "@workspace/db";
import { TIERS, TIER_THRESHOLDS } from "@workspace/db/enums";
import { asc } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";

export type TierName = (typeof TIERS)[number];
export type TierThresholds = Record<TierName, number>;

type CacheEntry = { value: TierThresholds; expiresAt: number };
let cache: CacheEntry | null = null;
/** Tiers change roughly never; a minute is plenty and keeps an edit responsive. */
const TTL_MS = 60_000;

/** Clear the cache (tests + threshold writes). */
export function clearTierThresholdCache(): void {
  cache = null;
}

/** The configured ladder, falling back to the AT23 constant when unset. */
export async function resolveTierThresholds(): Promise<TierThresholds> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const resolved: TierThresholds = { ...TIER_THRESHOLDS };
  try {
    const rows = await db
      .select({
        tier: punya_tier_thresholds.tier,
        min_points: punya_tier_thresholds.min_points,
      })
      .from(punya_tier_thresholds)
      .orderBy(asc(punya_tier_thresholds.min_points));
    for (const row of rows) {
      if (row.tier in resolved) resolved[row.tier as TierName] = row.min_points;
    }
  } catch {
    // Table missing or unreachable — the constant already holds the documented
    // ladder, so returning it is strictly better than failing an award.
  }

  cache = { value: resolved, expiresAt: Date.now() + TTL_MS };
  return resolved;
}

/**
 * Tier for a total, against a resolved ladder.
 *
 * Mirrors tierForPoints in enums.ts, which stays for the synchronous callers
 * (the seed, and result shaping where the ladder has already been applied).
 */
export function tierForPointsWith(totalPoints: number, thresholds: TierThresholds): TierName {
  let current: TierName = "jigyasu";
  for (const t of TIERS) {
    if (totalPoints >= thresholds[t]) current = t;
  }
  return current;
}

/**
 * The tier ladder as a SQL CASE over an integer expression.
 *
 * One builder for every ladder in the codebase, so they cannot drift.
 *
 * BOTH SIDES ARE CAST TO int, and that is not decoration. When `expr` is a
 * bare bound parameter — which it is on the INSERT branch of creditBalance,
 * where the new balance is just the delta — Postgres infers `text` for both
 * operands and compares them as STRINGS. '75' >= '5001' is true, because '7'
 * sorts after '5'.
 *
 * That is a real, long-standing bug this builder inherited: a student's
 * FIRST EVER award of 75 points wrote tier='tirthankar', and 600 points did
 * too. It survived because it only ever hit the insert path (one award per
 * student, ever) and because punya.reconcile omitted `tier` from its DO
 * UPDATE (H3), so nothing downstream ever recomputed it.
 */
export function tierCaseSql(expr: SQL, thresholds: TierThresholds): SQL {
  const v = sql`(${expr})::int`;
  return sql`(case
    when ${v} >= ${thresholds.tirthankar}::int then 'tirthankar'::tier_enum
    when ${v} >= ${thresholds.shraman}::int then 'shraman'::tier_enum
    when ${v} >= ${thresholds.sadhak}::int then 'sadhak'::tier_enum
    when ${v} >= ${thresholds.shravak}::int then 'shravak'::tier_enum
    else 'jigyasu'::tier_enum
  end)`;
}

/** Next tier up and the distance to it — null once Tirthankar is reached. */
export function nextTierFor(
  totalPoints: number,
  thresholds: TierThresholds,
): { next_tier: TierName | null; points_to_next: number | null } {
  const current = tierForPointsWith(totalPoints, thresholds);
  const idx = TIERS.indexOf(current);
  const next = idx >= 0 && idx < TIERS.length - 1 ? TIERS[idx + 1]! : null;
  if (!next) return { next_tier: null, points_to_next: null };
  return { next_tier: next, points_to_next: Math.max(0, thresholds[next] - totalPoints) };
}
