/**
 * F12 — advisory homework ↔ curriculum_item link.
 * Validates that a topic belongs to an active curriculum available for the
 * batch's city (and MSV vs standard kind). Does not touch progress rows.
 */
import { db, batches, centres, curricula, curriculum_items, curriculum_sections } from "@workspace/db";
import { and, asc, eq, or, sql } from "drizzle-orm";

export type CurriculumTopicLabel = {
  curriculum_item_id: string;
  topic_en: string;
  topic_hi: string;
  section_title_en: string;
  section_title_hi: string;
  curriculum_id: string;
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
 * City-agnostic curricula (city_id null) are allowed for any batch.
 */
export async function resolveCurriculumItemForBatch(opts: {
  batchId: string;
  curriculumItemId: string;
  isMsv: boolean;
}): Promise<CurriculumTopicLabel | null> {
  const kind = opts.isMsv ? "msv" : "standard";
  const [row] = await db
    .select({
      curriculum_item_id: curriculum_items.id,
      topic_en: curriculum_items.title_en,
      topic_hi: curriculum_items.title_hi,
      section_title_en: curriculum_sections.title_en,
      section_title_hi: curriculum_sections.title_hi,
      curriculum_id: curricula.id,
      city_id: curricula.city_id,
      kind: curricula.kind,
      status: curricula.status,
      centre_city_id: centres.city_id,
    })
    .from(curriculum_items)
    .innerJoin(curriculum_sections, eq(curriculum_sections.id, curriculum_items.section_id))
    .innerJoin(curricula, eq(curricula.id, curriculum_sections.curriculum_id))
    .innerJoin(batches, eq(batches.id, opts.batchId))
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .where(eq(curriculum_items.id, opts.curriculumItemId))
    .limit(1);

  if (!row) return null;
  if (row.status !== "active") return null;
  if (row.kind !== kind) return null;
  if (row.city_id != null && row.city_id !== row.centre_city_id) return null;

  return {
    curriculum_item_id: row.curriculum_item_id,
    topic_en: row.topic_en,
    topic_hi: row.topic_hi,
    section_title_en: row.section_title_en,
    section_title_hi: row.section_title_hi,
    curriculum_id: row.curriculum_id,
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
      id: curriculum_items.id,
      topic_en: curriculum_items.title_en,
      topic_hi: curriculum_items.title_hi,
      section_en: curriculum_sections.title_en,
      section_hi: curriculum_sections.title_hi,
      curriculum_name: curricula.name,
      order_section: curriculum_sections.order_index,
      order_item: curriculum_items.order_index,
    })
    .from(curriculum_items)
    .innerJoin(curriculum_sections, eq(curriculum_sections.id, curriculum_items.section_id))
    .innerJoin(curricula, eq(curricula.id, curriculum_sections.curriculum_id))
    .where(
      and(
        eq(curricula.status, "active"),
        eq(curricula.kind, kind),
        or(sql`${curricula.city_id} is null`, eq(curricula.city_id, batch.city_id)),
      ),
    )
    .orderBy(asc(curriculum_sections.order_index), asc(curriculum_items.order_index));

  return rows.map((r) => ({
    id: r.id,
    label_en: formatCurriculumTopicLabel(r.section_en, r.topic_en),
    label_hi: formatCurriculumTopicLabel(r.section_hi, r.topic_hi),
    curriculum_name: r.curriculum_name,
  }));
}
