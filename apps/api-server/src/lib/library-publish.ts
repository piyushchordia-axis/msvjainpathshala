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

import {
  panchangAnchorIssues,
  panchangYearSchema,
  type PanchangAnchorIssue,
} from "@workspace/api-zod";

import { publishLinkedContentRequests } from "./library-requests-admin";

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

/**
 * Publishing an item with no modality violates the CHECK constraint, which
 * surfaced as a raw 500 telling the admin nothing. §17.1.3 is the rule; this
 * is how the admin hears about it.
 */
export class LibraryPublishError extends Error {
  readonly code = "ERR_VALIDATION_FAILED" as const;
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "LibraryPublishError";
  }
}

/** §17.1.3 — one of these must be present before readers can open it. */
function draftHasModality(row: typeof library_items.$inferSelect): boolean {
  return !!(
    row.draft_audio_url ||
    row.draft_youtube_url ||
    row.draft_text_content_en ||
    row.draft_pdf_url ||
    row.pdf_asset_id ||
    row.draft_external_url
  );
}

export async function publishItem(id: string) {
  const [row] = await db
    .select()
    .from(library_items)
    .where(and(eq(library_items.id, id), isNull(library_items.deleted_at)))
    .limit(1);
  if (!row) return null;
  if (!draftHasModality(row)) {
    throw new LibraryPublishError(
      "This item has nothing to open yet — add audio, text, a PDF, a video link or an external link, then publish.",
    );
  }
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
      tarj_en: row.draft_tarj_en,
      tarj_hi: row.draft_tarj_hi,
      pdf_url: row.draft_pdf_url,
      pdf_size_bytes: row.draft_pdf_size_bytes,
      pdf_page_count: row.draft_pdf_page_count,
      external_url: row.draft_external_url,
      is_published: true,
      content_version: row.content_version + 1,
      updated_at: new Date(),
    })
    .where(eq(library_items.id, id))
    .returning();
  if (!updated) return null;

  // §17.10.4 — `published` on a content request is SYSTEM-SET, and this is the
  // moment it becomes true: the thing someone asked for is now in the library.
  // It lives on the publish service path rather than in the route so any future
  // caller (a bulk publish, a worker) flips the requests too. Never throws.
  await publishLinkedContentRequests(updated.id);

  return updated;
}

export async function unpublishItem(id: string) {
  const [updated] = await db
    .update(library_items)
    .set({ is_published: false, updated_at: new Date() })
    .where(and(eq(library_items.id, id), isNull(library_items.deleted_at)))
    .returning();
  return updated ?? null;
}

export type PublishPanchangResult =
  | { status: "not_found" }
  | { status: "rejected"; issues: PanchangAnchorIssue[] }
  | { status: "published"; row: NonNullable<Awaited<ReturnType<typeof selectPanchangYear>>> };

async function selectPanchangYear(year: number) {
  const [row] = await db
    .select()
    .from(panchang_years)
    .where(and(eq(panchang_years.year, year), isNull(panchang_years.deleted_at)))
    .limit(1);
  return row ?? null;
}

/**
 * Publish a Panchang year — the gate, not merely a column copy.
 *
 * The validation lives HERE rather than in the route because publication is the
 * moment unverified data becomes something a family plans a fast around, and a
 * check a second route could forget to call is not a gate. A draft may be saved
 * in any state; it may only be published once it parses (provenance included,
 * §17.6.1) and contradicts none of the anchor rules.
 *
 * Rejection is not advisory. The previous year shipped with Samvatsari three
 * weeks early, and no step between "someone typed it" and "families read it"
 * would have caught that.
 */
export async function publishPanchangYear(year: number): Promise<PublishPanchangResult> {
  const row = await selectPanchangYear(year);
  if (!row) return { status: "not_found" };

  const parsed = panchangYearSchema.safeParse(row.draft_payload);
  if (!parsed.success) {
    return {
      status: "rejected",
      issues: parsed.error.issues.map((i) => ({
        rule: i.path.join(".") || "payload",
        message: i.message,
      })),
    };
  }
  const issues = panchangAnchorIssues(parsed.data);
  if (issues.length > 0) return { status: "rejected", issues };

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
  if (!updated) return { status: "not_found" };
  return { status: "published", row: updated };
}

export async function unpublishPanchangYear(year: number) {
  const [updated] = await db
    .update(panchang_years)
    .set({ is_published: false, updated_at: new Date() })
    .where(and(eq(panchang_years.year, year), isNull(panchang_years.deleted_at)))
    .returning();
  return updated ?? null;
}
