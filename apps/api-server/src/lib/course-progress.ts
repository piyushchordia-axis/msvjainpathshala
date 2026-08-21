/**
 * Thin wrappers around fn_course_progress (CU28 / AT5 pattern).
 * Never re-implement coverage or mastery arithmetic in TypeScript — PDF worker,
 * mobile, admin, CU16 section roll-up, and CU30's report `courses` block all
 * call this SQL function.
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

export type CourseSectionRollup = { section_id: string } & CourseProgressStats;

/**
 * M5 — CU16's section roll-up for every section of a course, in ONE round
 * trip instead of one `getCourseProgress` call per section. A LATERAL join
 * still invokes fn_course_progress once per section (same CU28 arithmetic,
 * still the one canonical calculation), but the whole set comes back over a
 * single query instead of N sequential ones.
 */
export async function getCourseSectionRollups(
  studentId: string,
  courseId: string,
): Promise<CourseSectionRollup[]> {
  const result = await db.execute(sql`
    select
      cs.id as section_id,
      fp.leaf_total,
      fp.leaf_reached,
      fp.leaf_certified,
      fp.section_total,
      fp.section_certified,
      fp.coverage,
      fp.mastery
    from course_sections cs
    cross join lateral fn_course_progress(${studentId}::uuid, ${courseId}::uuid, cs.id) fp
    where cs.course_id = ${courseId}::uuid
      and cs.deleted_at is null
  `);
  const rows =
    (
      result as unknown as {
        rows?: Array<{
          section_id: string;
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
  return rows.map((row) => ({
    section_id: row.section_id,
    leaf_total: asInt(row.leaf_total),
    leaf_reached: asInt(row.leaf_reached),
    leaf_certified: asInt(row.leaf_certified),
    section_total: asInt(row.section_total),
    section_certified: asInt(row.section_certified),
    coverage: asRatio(row.coverage),
    mastery: asRatio(row.mastery),
  }));
}

export type CourseProgressCertifiedNode = {
  node_id: string;
  node_kind: "section" | "subsection";
  title_en: string;
  title_hi: string;
  certified_at: string;
};

export type CourseProgressReportBlock = {
  course_id: string;
  coverage: number | null;
  mastery: number | null;
  section_certified: number;
  section_total: number;
  certified_nodes: CourseProgressCertifiedNode[];
};

/**
 * CU30 (H28) — the progress-report `courses` block, one entry per course the
 * student has ANY progress row on (CU4: this includes archived courses — an
 * archived course must still appear in the student's own history/reports).
 * `coverage`/`mastery`/`section_certified`/`section_total` are read from
 * `fn_course_progress` (CU28) via `getCourseProgress` — never recomputed
 * here. `certified_nodes` is a factual listing (not an aggregate), safe to
 * build alongside it.
 */
export async function buildCourseProgressReportBlocks(
  studentId: string,
): Promise<CourseProgressReportBlock[]> {
  const touched = await db.execute(sql`
    select distinct co.id as course_id
    from student_course_progress p
    left join course_sections sec on sec.id = p.section_id
    left join course_subsections sub on sub.id = p.subsection_id
    left join course_sections sec_via_sub on sec_via_sub.id = sub.section_id
    inner join courses co on co.id = coalesce(sec.course_id, sec_via_sub.course_id)
    where p.student_id = ${studentId}::uuid
  `);
  const courseIds = (
    (touched as unknown as { rows?: Array<{ course_id: string }> }).rows ?? []
  ).map((r) => r.course_id);

  const blocks: CourseProgressReportBlock[] = [];
  for (const courseId of courseIds) {
    const stats = await getCourseProgress(studentId, courseId);
    const nodesResult = await db.execute(sql`
      select
        coalesce(p.section_id, p.subsection_id) as node_id,
        case when p.section_id is not null then 'section' else 'subsection' end as node_kind,
        coalesce(sec.title_en, sub.title_en) as title_en,
        coalesce(sec.title_hi, sub.title_hi) as title_hi,
        p.certified_at
      from student_course_progress p
      left join course_sections sec on sec.id = p.section_id
      left join course_subsections sub on sub.id = p.subsection_id
      left join course_sections sec_via_sub on sec_via_sub.id = sub.section_id
      where p.student_id = ${studentId}::uuid
        and p.certified_at is not null
        and coalesce(sec.course_id, sec_via_sub.course_id) = ${courseId}::uuid
      order by p.certified_at asc
    `);
    const certified_nodes: CourseProgressCertifiedNode[] = (
      (
        nodesResult as unknown as {
          rows?: Array<{
            node_id: string;
            node_kind: "section" | "subsection";
            title_en: string;
            title_hi: string;
            certified_at: string | Date;
          }>;
        }
      ).rows ?? []
    ).map((r) => ({
      node_id: r.node_id,
      node_kind: r.node_kind,
      title_en: r.title_en,
      title_hi: r.title_hi,
      certified_at:
        r.certified_at instanceof Date ? r.certified_at.toISOString() : String(r.certified_at),
    }));

    blocks.push({
      course_id: courseId,
      coverage: stats.coverage,
      mastery: stats.mastery,
      section_certified: stats.section_certified,
      section_total: stats.section_total,
      certified_nodes,
    });
  }
  return blocks;
}
