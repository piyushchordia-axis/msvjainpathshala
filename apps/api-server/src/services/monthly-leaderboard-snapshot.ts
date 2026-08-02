/**
 * Persist end-of-month city Punya leaderboards.
 * Replaces mv_monthly_leaderboard_city (an MV cannot retain prior months).
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const NIL_CITY = "00000000-0000-0000-0000-000000000000";

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
      select (
        date_trunc('month', timezone('Asia/Kolkata', now())) - interval '1 month'
      )::date as month
    ),
    ranked as (
      select
        coalesce(c.city_id, ${NIL_CITY}::uuid) as city_id,
        t.month,
        st.id as student_id,
        st.full_name,
        pb.total_points,
        pb.tier,
        rank() over (
          partition by coalesce(c.city_id, ${NIL_CITY}::uuid)
          order by pb.total_points desc, st.id
        ) as rank
      from punya_balances pb
      inner join students st
        on st.id = pb.student_id
       and st.deleted_at is null
       and st.status = 'active'
      left join centres c on c.id = st.centre_id
      cross join target t
    ),
    ins as (
      insert into monthly_leaderboard_snapshots (
        city_id, month, student_id, full_name, total_points, tier, rank
      )
      select city_id, month, student_id, full_name, total_points, tier, rank
      from ranked
      on conflict (city_id, month, student_id) do nothing
      returning id
    )
    select
      (select month::text from target) as month,
      (select count(*)::int from ins) as inserted
  `);

  const rows =
    (result as unknown as { rows?: Array<{ month: string; inserted: number }> }).rows ?? [];
  return {
    month: String(rows[0]?.month ?? ""),
    inserted: Number(rows[0]?.inserted ?? 0),
  };
}
