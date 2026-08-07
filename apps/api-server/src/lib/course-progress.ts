/**
 * Thin wrappers around fn_course_progress (CU28 / AT5 pattern).
 * Never re-implement coverage or mastery arithmetic in TypeScript — PDF worker,
 * mobile, admin, and CU16 section roll-up all call this SQL function.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type CourseProgressStats = {
  leaf_total: number;
  leaf_reached: number;
  leaf_certified: number;
  section_total: number;
  section_certified: number;
  /** 0–1, or null when leaf_total = 0. */
  coverage: number | null;
  /** 0–1, or null when leaf_reached = 0 (CU28). */
  mastery: number | null;
};

function asInt(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function asRatio(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Canonical progress for one student + course; optional section scope (CU16). */
export async function getCourseProgress(
  studentId: string,
  courseId: string,
  sectionId?: string | null,
): Promise<CourseProgressStats> {
  const result = await db.execute(sql`
    select
      leaf_total,
      leaf_reached,
      leaf_certified,
      section_total,
      section_certified,
      coverage,
      mastery
    from fn_course_progress(
      ${studentId}::uuid,
      ${courseId}::uuid,
      ${sectionId ?? null}::uuid
    )
  `);
  const rows =
    (
      result as unknown as {
        rows?: Array<{
          leaf_total: string | number;
          leaf_reached: string | number;
          leaf_certified: string | number;
          section_total: string | number;
          section_certified: string | number;
          coverage: string | number | null;
          mastery: string | number | null;
        }>;
      }
    ).rows ?? [];
  const row = rows[0];
  if (!row) {
    return {
      leaf_total: 0,
      leaf_reached: 0,
      leaf_certified: 0,
      section_total: 0,
      section_certified: 0,
      coverage: null,
      mastery: null,
    };
  }
  return {
    leaf_total: asInt(row.leaf_total),
    leaf_reached: asInt(row.leaf_reached),
    leaf_certified: asInt(row.leaf_certified),
    section_total: asInt(row.section_total),
    section_certified: asInt(row.section_certified),
    coverage: asRatio(row.coverage),
    mastery: asRatio(row.mastery),
  };
}
