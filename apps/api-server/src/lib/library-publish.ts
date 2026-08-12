/**
 * Copy draft_* → published columns and bump content_version.
 */
import {
  db,
  library_items,
  library_sections,
  library_subsections,
  panchang_years,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

export async function publishSection(id: string) {
  const [row] = await db
    .select()
    .from(library_sections)
    .where(and(eq(library_sections.id, id), isNull(library_sections.deleted_at)))
    .limit(1);
  if (!row) return null;
  const [updated] = await db
    .update(library_sections)
    .set({
      name_en: row.draft_name_en,
      name_hi: row.draft_name_hi,
      name_gu: row.draft_name_gu,
      icon_url: row.draft_icon_url,
      type: row.draft_type,
      deeplink_target: row.draft_deeplink_target,
      requires_login: row.draft_requires_login,
      order_index: row.draft_order_index,
      is_published: true,
      content_version: row.content_version + 1,
      updated_at: new Date(),
    })
    .where(eq(library_sections.id, id))
    .returning();
  return updated ?? null;
}

export async function unpublishSection(id: string) {
  const [updated] = await db
    .update(library_sections)
    .set({ is_published: false, updated_at: new Date() })
    .where(and(eq(library_sections.id, id), isNull(library_sections.deleted_at)))
    .returning();
  return updated ?? null;
}

export async function publishSubsection(id: string) {
  const [row] = await db
    .select()
    .from(library_subsections)
    .where(and(eq(library_subsections.id, id), isNull(library_subsections.deleted_at)))
    .limit(1);
  if (!row) return null;
  const [updated] = await db
    .update(library_subsections)
    .set({
      name_en: row.draft_name_en,
      name_hi: row.draft_name_hi,
      name_gu: row.draft_name_gu,
      order_index: row.draft_order_index,
      is_published: true,
      content_version: row.content_version + 1,
      updated_at: new Date(),
    })
    .where(eq(library_subsections.id, id))
    .returning();
  return updated ?? null;
}

export async function unpublishSubsection(id: string) {
  const [updated] = await db
    .update(library_subsections)
    .set({ is_published: false, updated_at: new Date() })
    .where(and(eq(library_subsections.id, id), isNull(library_subsections.deleted_at)))
    .returning();
  return updated ?? null;
}

export async function publishItem(id: string) {
  const [row] = await db
    .select()
    .from(library_items)
    .where(and(eq(library_items.id, id), isNull(library_items.deleted_at)))
    .limit(1);
  if (!row) return null;
  const [updated] = await db
    .update(library_items)
    .set({
      title_en: row.draft_title_en,
      title_hi: row.draft_title_hi,
      title_gu: row.draft_title_gu,
      order_index: row.draft_order_index,
      audio_url: row.draft_audio_url,
      audio_size_bytes: row.draft_audio_size_bytes,
      audio_duration_sec: row.draft_audio_duration_sec,
      youtube_url: row.draft_youtube_url,
      text_content_en: row.draft_text_content_en,
      text_content_hi: row.draft_text_content_hi,
      text_content_gu: row.draft_text_content_gu,
      is_published: true,
      content_version: row.content_version + 1,
      updated_at: new Date(),
    })
    .where(eq(library_items.id, id))
    .returning();
  return updated ?? null;
}

export async function unpublishItem(id: string) {
  const [updated] = await db
    .update(library_items)
    .set({ is_published: false, updated_at: new Date() })
    .where(and(eq(library_items.id, id), isNull(library_items.deleted_at)))
    .returning();
  return updated ?? null;
}

export async function publishPanchangYear(year: number) {
  const [row] = await db
    .select()
    .from(panchang_years)
    .where(and(eq(panchang_years.year, year), isNull(panchang_years.deleted_at)))
    .limit(1);
  if (!row) return null;
  const draft = row.draft_payload as Record<string, unknown>;
  const nextPayload = {
    ...draft,
    contentVersion: row.content_version + 1,
  };
  const [updated] = await db
    .update(panchang_years)
    .set({
      published_payload: nextPayload,
      is_published: true,
      content_version: row.content_version + 1,
      sect: String(draft["sect"] ?? row.sect),
      vikram_samvat: Number(draft["vikramSamvat"] ?? row.vikram_samvat),
      veer_samvat: Number(draft["veerSamvat"] ?? row.veer_samvat),
      updated_at: new Date(),
    })
    .where(eq(panchang_years.id, row.id))
    .returning();
  return updated ?? null;
}

export async function unpublishPanchangYear(year: number) {
  const [updated] = await db
    .update(panchang_years)
    .set({ is_published: false, updated_at: new Date() })
    .where(and(eq(panchang_years.year, year), isNull(panchang_years.deleted_at)))
    .returning();
  return updated ?? null;
}
