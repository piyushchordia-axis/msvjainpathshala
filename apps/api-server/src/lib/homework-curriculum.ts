/**
 * F12 — advisory homework ↔ curriculum_item link.
 * Validates that a topic belongs to an active curriculum available for the
 * batch's city (and MSV vs standard kind). Does not touch progress rows.
 */
import { db, batches, centres, courses, course_subsections, course_sections } from "@workspace/db";
import { and, asc, eq, or, sql } from "drizzle-orm";

export type CurriculumTopicLabel = {
  subsection_id: string;
  topic_en: string;
  topic_hi: string;
  section_title_en: string;
  section_title_hi: string;
  course_id: string;
};

/** "Section: Item" display label for feeds. */
export function formatCurriculumTopicLabel(section: string, item: string): string {
  const s = section.trim();
  const i = item.trim();
  if (!s) return i;
  if (!i) return s;
  return `${s}: ${i}`;
}

/**
 * Returns the topic when it is valid for this batch + is_msv track; otherwise null.
 * City-agnostic courses (city_id null) are allowed for any batch.
 */
export async function resolveCurriculumItemForBatch(opts: {
  batchId: string;
  curriculumItemId: string;
  isMsv: boolean;
}): Promise<CurriculumTopicLabel | null> {
  const kind = opts.isMsv ? "msv" : "standard";
  const [row] = await db
    .select({
      subsection_id: course_subsections.id,
      topic_en: course_subsections.title_en,
      topic_hi: course_subsections.title_hi,
      section_title_en: course_sections.title_en,
      section_title_hi: course_sections.title_hi,
      course_id: courses.id,
      city_id: courses.city_id,
      kind: courses.kind,
      status: courses.status,
      centre_city_id: centres.city_id,
    })
    .from(course_subsections)
    .innerJoin(course_sections, eq(course_sections.id, course_subsections.section_id))
    .innerJoin(courses, eq(courses.id, course_sections.course_id))
    .innerJoin(batches, eq(batches.id, opts.batchId))
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .where(eq(course_subsections.id, opts.curriculumItemId))
    .limit(1);

  if (!row) return null;
  if (row.status !== "active") return null;
  if (row.kind !== kind) return null;
  if (row.city_id != null && row.city_id !== row.centre_city_id) return null;

  return {
    subsection_id: row.subsection_id,
    topic_en: row.topic_en,
    topic_hi: row.topic_hi,
    section_title_en: row.section_title_en,
    section_title_hi: row.section_title_hi,
    course_id: row.course_id,
  };
}

/** Topics available for the batch's city + track (for the admin selector). */
export async function listCurriculumTopicsForBatch(opts: {
  batchId: string;
  isMsv: boolean;
}): Promise<
  Array<{
    id: string;
    label_en: string;
    label_hi: string;
    curriculum_name: string;
  }>
> {
  const kind = opts.isMsv ? "msv" : "standard";
  const [batch] = await db
    .select({ city_id: centres.city_id })
    .from(batches)
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .where(eq(batches.id, opts.batchId))
    .limit(1);
  if (!batch) return [];

  const rows = await db
    .select({
      id: course_subsections.id,
      topic_en: course_subsections.title_en,
      topic_hi: course_subsections.title_hi,
      section_en: course_sections.title_en,
      section_hi: course_sections.title_hi,
      curriculum_name: courses.name_en,
      order_section: course_sections.order_index,
      order_item: course_subsections.order_index,
    })
    .from(course_subsections)
    .innerJoin(course_sections, eq(course_sections.id, course_subsections.section_id))
    .innerJoin(courses, eq(courses.id, course_sections.course_id))
    .where(
      and(
        eq(courses.status, "active"),
        eq(courses.kind, kind),
        or(sql`${courses.city_id} is null`, eq(courses.city_id, batch.city_id)),
      ),
    )
    .orderBy(asc(course_sections.order_index), asc(course_subsections.order_index));

  return rows.map((r) => ({
    id: r.id,
    label_en: formatCurriculumTopicLabel(r.section_en, r.topic_en),
    label_hi: formatCurriculumTopicLabel(r.section_hi, r.topic_hi),
    curriculum_name: r.curriculum_name,
  }));
}
