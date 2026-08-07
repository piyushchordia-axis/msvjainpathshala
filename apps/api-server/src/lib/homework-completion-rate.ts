/**
 * Thin wrappers around the canonical PostgreSQL homework_completion_rate*
 * functions (F4 / AT5 pattern). Never re-implement the FILTER arithmetic in
 * TypeScript — MV, dashboard, and progress report must share one implementation.
 * Per-batch callers must use getBatchHomeworkCompletionRates
 * (homework_completion_rate_by_batch) rather than writing their own SQL.
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

/**
 * Per-batch rates for a centre (AT5/F4 SRF homework_completion_rate_by_batch).
 * Only batches with in-scope submission rows appear — callers that need every
 * active batch should LEFT JOIN / look up into this map (null = no homework set).
 */
export async function getBatchHomeworkCompletionRates(
  centreId: string,
  from?: string | null,
  to?: string | null,
): Promise<Map<string, number | null>> {
  const result = await db.execute(sql`
    select batch_id, homework_rate
    from homework_completion_rate_by_batch(
      ${centreId}::uuid,
      ${from ?? null}::date,
      ${to ?? null}::date
    )
  `);
  const rows =
    (
      result as unknown as {
        rows?: Array<{ batch_id: string; homework_rate: string | number | null }>;
      }
    ).rows ?? [];
  const map = new Map<string, number | null>();
  for (const r of rows) {
    map.set(String(r.batch_id), asRate(r.homework_rate));
  }
  return map;
}
