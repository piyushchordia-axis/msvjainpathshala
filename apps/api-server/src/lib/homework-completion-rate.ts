/**
 * Thin wrappers around the canonical PostgreSQL homework_completion_rate*
 * functions (F4 / AT5 pattern). Never re-implement the FILTER arithmetic in
 * TypeScript — MV, dashboard, and progress report must share one implementation.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

function asRate(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Ratio 0–1 (or null when no in-scope assignments / submissions). */
export async function getStudentHomeworkCompletionRate(
  studentId: string,
  from?: string | null,
  to?: string | null,
): Promise<number | null> {
  const result = await db.execute(sql`
    select homework_completion_rate(
      ${studentId}::uuid,
      ${from ?? null}::date,
      ${to ?? null}::date
    ) as rate
  `);
  const rows = (result as unknown as { rows?: Array<{ rate: string | number | null }> }).rows ?? [];
  return asRate(rows[0]?.rate);
}

/** Ratio 0–1 across centres (null centreIds = all). */
export async function getCentresHomeworkCompletionRate(
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
    select homework_completion_rate_for_centres(
      ${centresSql},
      ${from ?? null}::date,
      ${to ?? null}::date
    ) as rate
  `);
  const rows = (result as unknown as { rows?: Array<{ rate: string | number | null }> }).rows ?? [];
  return asRate(rows[0]?.rate);
}
