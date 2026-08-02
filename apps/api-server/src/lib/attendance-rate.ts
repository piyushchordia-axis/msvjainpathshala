/**
 * Thin wrappers around the canonical PostgreSQL attendance_percentage functions (AT5).
 * Never re-implement the FILTER arithmetic in TypeScript — MVs and every surface
 * must share one implementation or the numbers drift.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

function asRate(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Ratio 0–1 (or null when countable denominator is 0). */
export async function getStudentAttendanceRate(
  studentId: string,
  from?: string | null,
  to?: string | null,
): Promise<number | null> {
  const result = await db.execute(sql`
    select attendance_percentage(
      ${studentId}::uuid,
      ${from ?? null}::date,
      ${to ?? null}::date
    ) as rate
  `);
  const rows = (result as unknown as { rows?: Array<{ rate: string | number | null }> }).rows ?? [];
  return asRate(rows[0]?.rate);
}

/** Ratio 0–1 across centres (null centreIds = all). */
export async function getCentresAttendanceRate(
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
    select attendance_percentage_for_centres(
      ${centresSql},
      ${from ?? null}::date,
      ${to ?? null}::date
    ) as rate
  `);
  const rows = (result as unknown as { rows?: Array<{ rate: string | number | null }> }).rows ?? [];
  return asRate(rows[0]?.rate);
}

/** Display helper: percent with one decimal (matches admin overview). */
export function rateToPercent1(rate: number | null): number {
  if (rate == null) return 0;
  return Math.round(rate * 1000) / 10;
}

/** Whole-number percent for mobile pills. */
export function rateToPercent0(rate: number | null): number | null {
  if (rate == null) return null;
  return Math.round(rate * 100);
}
