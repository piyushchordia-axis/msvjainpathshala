/**
 * Centre Niyam APPROVAL rate — approved (+ auto_approved) over DECIDED
 * submissions in range. Same SQL-only pattern as attendance / homework helpers;
 * never re-implement in TypeScript call sites.
 *
 * Renamed from "completion rate" (M3). It never measured completion: children
 * who submitted nothing appear in neither term, so it says nothing about how
 * many kept their niyams. Worse, `pending` sat in the denominator, so an
 * un-actioned review queue read as low compliance and the Sanchalak's monthly
 * report blamed the centre for the reviewer's backlog.
 *
 * `pending` is now excluded from both sides — a submission nobody has judged is
 * not evidence either way. Only approved / auto_approved / rejected count.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

function asRate(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Ratio 0–1 (null when nothing has been decided in range). */
export async function getCentresNiyamApprovalRate(
  centreIds: string[] | null,
  from?: string | null,
  to?: string | null,
): Promise<number | null> {
  const centresSql =
    centreIds === null
      ? sql`null::uuid[]`
      : sql`array[${sql.join(
          centreIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}]::uuid[]`;

  const result = await db.execute(sql`
    select (
      count(*) filter (where ns.status in ('approved', 'auto_approved'))::numeric
      / nullif(count(*) filter (where ns.status in ('approved', 'auto_approved', 'rejected')), 0)
    ) as rate
    from niyam_submissions ns
    inner join students st on st.id = ns.student_id
    where (${centresSql} is null or st.centre_id = any (${centresSql}))
      and st.deleted_at is null
      and (${from ?? null}::date is null or ns.submission_date >= ${from ?? null}::date)
      and (${to ?? null}::date is null or ns.submission_date <= ${to ?? null}::date)
  `);
  const rows = (result as unknown as { rows?: Array<{ rate: string | number | null }> }).rows ?? [];
  return asRate(rows[0]?.rate);
}
