/**
 * Persist end-of-month city Punya leaderboards.
 * Replaces mv_monthly_leaderboard_city (an MV cannot retain prior months).
 *
 * H1. This ranked `punya_balances.total_points` — a LIFETIME cumulative balance
 * that is never reset — and wrote it under a month label. Every month's
 * "monthly leaderboard" was a copy of the all-time ranking: a student who
 * earned 5 points in November but held 4,000 lifetime ranked #1 for November,
 * and a child who had a brilliant month appeared nowhere. BRD §7.6 says the
 * centre and city leaderboards RESET monthly.
 *
 * It also wrote every active student rather than the top 20 (M16), and ran every
 * five minutes rather than monthly — roughly 8,640 full-table window-function
 * scans a month, of which the first tick after midnight IST on the 1st won the
 * ON CONFLICT DO NOTHING and the other ~8,600 did the work for nothing.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const NIL_CITY = "00000000-0000-0000-0000-000000000000";

/** BRD §7.6 — the board shows a top 20. */
export const LEADERBOARD_SNAPSHOT_SIZE = 20;

/**
 * Snapshot the calendar month just ended (Asia/Kolkata) into
 * monthly_leaderboard_snapshots. Idempotent: ON CONFLICT DO NOTHING.
 */
export async function snapshotMonthlyLeaderboard(): Promise<{
  month: string;
  inserted: number;
}> {
  const result = await db.execute(sql`
    with target as (
      select
        (date_trunc('month', timezone('Asia/Kolkata', now())) - interval '1 month')::date
          as month_start,
        date_trunc('month', timezone('Asia/Kolkata', now()))::date as month_end
    ),
    earned as (
      -- What each student EARNED in the month, not what they have ever held.
      -- SUM, not a filter on positives: a reversal is a negative row and has to
      -- net off, or a child rejected in the same month still ranks for it.
      select
        pt.student_id,
        sum(pt.points)::int as month_points
      from punya_transactions pt
      cross join target t
      where pt.created_at >= t.month_start
        and pt.created_at < t.month_end
      group by pt.student_id
      having sum(pt.points) > 0
    ),
    ranked as (
      select
        coalesce(c.city_id, ${NIL_CITY}::uuid) as city_id,
        t.month_start as month,
        st.id as student_id,
        st.full_name,
        e.month_points,
        coalesce(pb.tier, 'jigyasu') as tier,
        rank() over (
          partition by coalesce(c.city_id, ${NIL_CITY}::uuid)
          -- st.id breaks ties deterministically, so a re-run cannot reshuffle
          -- students who scored the same.
          order by e.month_points desc, st.id
        ) as rank
      from earned e
      inner join students st
        on st.id = e.student_id
       and st.deleted_at is null
       and st.status = 'active'
      left join punya_balances pb on pb.student_id = st.id
      left join centres c on c.id = st.centre_id
      cross join target t
    ),
    ins as (
      insert into monthly_leaderboard_snapshots (
        city_id, month, student_id, full_name, total_points, tier, rank
      )
      select city_id, month, student_id, full_name, month_points, tier, rank
      from ranked
      -- M16: BRD 7.6 specifies a top 20. Writing every active student made the
      -- table grow by one row per student per month, forever, for a board that
      -- shows twenty names.
      where rank <= ${LEADERBOARD_SNAPSHOT_SIZE}
      on conflict (city_id, month, student_id) do nothing
      returning id
    )
    select
      (select month_start::text from target) as month,
      (select count(*)::int from ins) as inserted
  `);

  const rows =
    (result as unknown as { rows?: Array<{ month: string; inserted: number }> }).rows ?? [];
  return {
    month: String(rows[0]?.month ?? ""),
    inserted: Number(rows[0]?.inserted ?? 0),
  };
}
