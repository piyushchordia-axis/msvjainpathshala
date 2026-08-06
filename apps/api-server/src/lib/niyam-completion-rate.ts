/**
 * Thin wrapper for centre Niyam completion — approved (+ auto_approved) over all
 * submissions in range. Same SQL-only pattern as attendance / homework helpers;
 * never re-implement in TypeScript call sites.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

function asRate(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Ratio 0–1 (null when no submissions in range). */
export async function getCentresNiyamCompletionRate(
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
      / nullif(count(*), 0)
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
