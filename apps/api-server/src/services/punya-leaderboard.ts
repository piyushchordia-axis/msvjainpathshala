/**
 * Punya leaderboards (H2, BRD §7.6, SPEC §6.9).
 *
 * There was no leaderboard endpoint at any scope. `monthly_leaderboard_snapshots`
 * was written but read by nothing — no route, no service, no page, no mobile
 * query — so the only artefact of the whole feature was a table that grew one
 * row per active student per month with no consumer.
 *
 * Ranking is Postgres-authoritative rather than Redis sorted sets (SPEC §8.5).
 * The award engine is synchronous and in-transaction, so a zset would be a
 * second source of truth that can silently disagree with the ledger, and Redis
 * is optional in local/dev per CLAUDE.md. The denormalised city/centre/batch
 * columns added in 0094 make the scoped read a single indexed scan; the shared
 * cache in front of it is a latency optimisation that can be dropped without
 * changing an answer.
 *
 * Monthly by default, because BRD §7.6 says centre and city boards RESET
 * monthly. `period=all_time` reads the lifetime balance for the rare case where
 * a cumulative view is genuinely wanted.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { createPointsCache } from "../lib/punya-points-cache";

export type LeaderboardScope = "batch" | "centre" | "city" | "msv";
export type LeaderboardPeriod = "month" | "all_time";

export interface LeaderboardRow {
  rank: number;
  student_id: string;
  full_name: string;
  student_code: string | null;
  tier: string;
  points: number;
}

export interface LeaderboardResult {
  scope: LeaderboardScope;
  scope_id: string | null;
  /**
   * SPEC 6.9 — 'rank' shows ordinal positions, 'tier' hides them and shows
   * tier badges instead. Served rather than decided per client, so the two
   * apps cannot disagree about whether a batch of eight-year-olds is
   * publicly ranked.
   */
  display_mode: "rank" | "tier";
  period: LeaderboardPeriod;
  month: string | null;
  items: LeaderboardRow[];
  /** The caller's own student, even when outside the top N (SPEC §6.9). */
  me: LeaderboardRow | null;
  /** How many students are ranked in this scope at all. */
  total_ranked: number;
}

/** Short TTL: a board that lags a minute is fine; one that lags an hour is not. */
const cache = createPointsCache<LeaderboardResult>("leaderboard", 60_000);

export function clearLeaderboardCache(): void {
  cache.clear();
}

/** First day of the current Asia/Kolkata month, as YYYY-MM-DD. */
function currentMonthStartIst(): string {
  const ist = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return `${ist.slice(0, 7)}-01`;
}

/**
 * Top N for a scope, plus the caller's own rank.
 *
 * `selfStudentId` is ranked from the SAME window function as the board, so a
 * student outside the top N still sees a rank consistent with it rather than
 * one computed by a second query that could disagree.
 */
export async function getLeaderboard(opts: {
  scope: LeaderboardScope;
  scopeId: string | null;
  period: LeaderboardPeriod;
  limit: number;
  selfStudentId?: string | null;
  /** Batch boards can be set to hide ordinals (SPEC 6.9). */
  displayMode?: "rank" | "tier";
}): Promise<LeaderboardResult> {
  const { scope, scopeId, period, limit } = opts;
  const selfId = opts.selfStudentId ?? null;
  const monthStart = period === "month" ? currentMonthStartIst() : null;

  const displayMode = opts.displayMode ?? "rank";
  const cacheKey = `${scope}:${scopeId ?? "all"}:${period}:${limit}:${selfId ?? "-"}:${displayMode}`;
  const hit = await cache.get(cacheKey);
  if (hit) return hit;

  // Scope predicate over the denormalised columns (0094) — no join needed.
  const scopeFilter =
    scope === "batch"
      ? sql`pt.batch_id = ${scopeId}::uuid`
      : scope === "centre"
        ? sql`pt.centre_id = ${scopeId}::uuid`
        : scope === "city"
          ? sql`pt.city_id = ${scopeId}::uuid`
          : // msv: the parallel track, optionally narrowed to one city
            scopeId
            ? sql`pt.is_msv_track = true and pt.city_id = ${scopeId}::uuid`
            : sql`pt.is_msv_track = true`;

  const periodFilter =
    monthStart == null
      ? sql`true`
      : sql`pt.created_at >= ${monthStart}::date
            and pt.created_at < (${monthStart}::date + interval '1 month')`;

  const result = await db.execute(sql`
    with earned as (
      select pt.student_id, sum(pt.points)::int as points
      from punya_transactions pt
      where ${scopeFilter} and ${periodFilter}
      group by pt.student_id
      -- A net-zero or negative month is not a placing.
      having sum(pt.points) > 0
    ),
    ranked as (
      select
        st.id as student_id,
        st.full_name,
        st.student_code,
        coalesce(pb.tier, 'jigyasu')::text as tier,
        e.points,
        -- Ties broken by id so a re-read cannot reshuffle equal scores.
        rank() over (order by e.points desc, st.id)::int as rank,
        count(*) over ()::int as total_ranked
      from earned e
      inner join students st
        on st.id = e.student_id
       -- Q11: deactivated students keep their history but leave the board.
       and st.deleted_at is null
       and st.status = 'active'
      left join punya_balances pb on pb.student_id = st.id
    )
    select student_id, full_name, student_code, tier, points, rank, total_ranked
    from ranked
    where rank <= ${limit}
       or student_id = ${selfId}::uuid
    order by rank asc
  `);

  const rows =
    (result as unknown as {
      rows?: Array<LeaderboardRow & { total_ranked: number }>;
    }).rows ?? [];

  const items = rows
    .filter((r) => r.rank <= limit)
    .map((r) => ({
      rank: Number(r.rank),
      student_id: r.student_id,
      full_name: r.full_name,
      student_code: r.student_code,
      tier: r.tier,
      points: Number(r.points),
    }));
  const meRow = selfId ? rows.find((r) => r.student_id === selfId) : undefined;

  const out: LeaderboardResult = {
    scope,
    scope_id: scopeId,
    display_mode: displayMode,
    period,
    month: monthStart,
    items,
    me: meRow
      ? {
          rank: Number(meRow.rank),
          student_id: meRow.student_id,
          full_name: meRow.full_name,
          student_code: meRow.student_code,
          tier: meRow.tier,
          points: Number(meRow.points),
        }
      : null,
    total_ranked: Number(rows[0]?.total_ranked ?? 0),
  };

  await cache.set(cacheKey, out);
  return out;
}
