/**
 * Published library tree: Section → SubSection → Item.
 *
 * Guests see every published section (including requires_login) so the UI can
 * show a login prompt on tap — but gated sections ship without children /
 * delivery payload until the member feed is used after sign-in.
 */
import {
  db,
  library_items,
  library_sections,
  library_subsections,
} from "@workspace/db";
import type { LibraryItemDto, LibrarySectionDto, LibrarySubsectionDto } from "@workspace/api-zod";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { signUploadUrl } from "./file-tokens";

export type BuildLibraryTreeOpts = {
  /**
   * When true, include requires_login sections as catalogue rows only
   * (empty subsections/items). Open content still requires the member feed.
   */
  guestOnly: boolean;
};

function mapItem(row: typeof library_items.$inferSelect): LibraryItemDto {
  return {
    id: row.id,
    section_id: row.section_id,
    subsection_id: row.subsection_id,
    item_code: row.item_code,
    title_en: row.title_en,
    title_hi: row.title_hi,
    title_gu: row.title_gu,
    order_index: row.order_index,
    // Gated /uploads needs a short-lived sig; external paste URLs pass through.
    audio_url: signUploadUrl(row.audio_url),
    audio_size_bytes: row.audio_size_bytes,
    audio_duration_sec: row.audio_duration_sec,
    youtube_url: row.youtube_url,
    text_content_en: row.text_content_en,
    text_content_hi: row.text_content_hi,
    text_content_gu: row.text_content_gu,
    tarj_en: row.tarj_en,
    tarj_hi: row.tarj_hi,
    // Signed here like audio_url, so the tree is browsable offline and the
    // reader still cannot be deep-linked by an unsigned URL. Clients treat
    // this copy as expiring and re-fetch the item at download time (§17.4).
    pdf_url: signUploadUrl(row.pdf_url),
    pdf_size_bytes: row.pdf_size_bytes,
    pdf_page_count: row.pdf_page_count,
    // Never signed — a third-party document link is not ours to sign.
    external_url: row.external_url,
    content_version: row.content_version,
    is_published: row.is_published,
  };
}

function mapSubsection(
  row: typeof library_subsections.$inferSelect,
  items: LibraryItemDto[],
): LibrarySubsectionDto {
  return {
    id: row.id,
    section_id: row.section_id,
    name_en: row.name_en,
    name_hi: row.name_hi,
    name_gu: row.name_gu,
    order_index: row.order_index,
    is_published: row.is_published,
    content_version: row.content_version,
    items,
  };
}

export async function buildLibraryTree(
  opts: BuildLibraryTreeOpts,
): Promise<LibrarySectionDto[]> {
  const sections = await db
    .select()
    .from(library_sections)
    .where(and(isNull(library_sections.deleted_at), eq(library_sections.is_published, true)))
    .orderBy(asc(library_sections.order_index));

  if (sections.length === 0) return [];

  // Load children only for sections the caller may open without signing in.
  // Gated rows stay visible as shells on the public catalogue.
  const contentSectionIds = sections
    .filter((s) => !(opts.guestOnly && s.requires_login))
    .map((s) => s.id);

  const subsections =
    contentSectionIds.length === 0
      ? []
      : await db
          .select()
          .from(library_subsections)
          .where(
            and(
              inArray(library_subsections.section_id, contentSectionIds),
              isNull(library_subsections.deleted_at),
              eq(library_subsections.is_published, true),
            ),
          )
          .orderBy(asc(library_subsections.order_index));

  const items =
    contentSectionIds.length === 0
      ? []
      : await db
          .select()
          .from(library_items)
          .where(
            and(
              inArray(library_items.section_id, contentSectionIds),
              isNull(library_items.deleted_at),
              eq(library_items.is_published, true),
            ),
          )
          .orderBy(asc(library_items.order_index));

  const itemsBySubsection = new Map<string, LibraryItemDto[]>();
  const itemsBySectionLoose = new Map<string, LibraryItemDto[]>();

  for (const row of items) {
    const dto = mapItem(row);
    if (row.subsection_id) {
      const list = itemsBySubsection.get(row.subsection_id) ?? [];
      list.push(dto);
      itemsBySubsection.set(row.subsection_id, list);
    } else {
      const list = itemsBySectionLoose.get(row.section_id) ?? [];
      list.push(dto);
      itemsBySectionLoose.set(row.section_id, list);
    }
  }

  const subsBySection = new Map<string, LibrarySubsectionDto[]>();
  for (const row of subsections) {
    const dto = mapSubsection(row, itemsBySubsection.get(row.id) ?? []);
    const list = subsBySection.get(row.section_id) ?? [];
    list.push(dto);
    subsBySection.set(row.section_id, list);
  }

  return sections.map((s) => {
    const redact = opts.guestOnly && s.requires_login;
    return {
      id: s.id,
      key: s.key,
      name_en: s.name_en,
      name_hi: s.name_hi,
      name_gu: s.name_gu,
      icon_url: s.icon_url,
      order_index: s.order_index,
      type: s.type,
      // Deeplink target is part of open behaviour — keep it so post-login resume
      // can reconstruct the destination; navigation is still client-gated.
      deeplink_target: s.deeplink_target,
      requires_login: s.requires_login,
      is_published: s.is_published,
      content_version: s.content_version,
      subsections: redact ? [] : (subsBySection.get(s.id) ?? []),
      items: redact ? [] : (itemsBySectionLoose.get(s.id) ?? []),
    };
  });
}

/**
 * One published section with the same nesting rules as buildLibraryTree.
 * Returns null when missing, unpublished, or soft-deleted.
 */
export async function buildLibrarySection(
  sectionId: string,
  opts: BuildLibraryTreeOpts,
): Promise<LibrarySectionDto | null> {
  const [section] = await db
    .select()
    .from(library_sections)
    .where(
      and(
        eq(library_sections.id, sectionId),
        isNull(library_sections.deleted_at),
        eq(library_sections.is_published, true),
      ),
    )
    .limit(1);

  if (!section) return null;

  const redact = opts.guestOnly && section.requires_login;
  if (redact) {
    return {
      id: section.id,
      key: section.key,
      name_en: section.name_en,
      name_hi: section.name_hi,
      name_gu: section.name_gu,
      icon_url: section.icon_url,
      order_index: section.order_index,
      type: section.type,
      deeplink_target: section.deeplink_target,
      requires_login: section.requires_login,
      is_published: section.is_published,
      content_version: section.content_version,
      subsections: [],
      items: [],
    };
  }

  const subsections = await db
    .select()
    .from(library_subsections)
    .where(
      and(
        eq(library_subsections.section_id, sectionId),
        isNull(library_subsections.deleted_at),
        eq(library_subsections.is_published, true),
      ),
    )
    .orderBy(asc(library_subsections.order_index));

  const items = await db
    .select()
    .from(library_items)
    .where(
      and(
        eq(library_items.section_id, sectionId),
        isNull(library_items.deleted_at),
        eq(library_items.is_published, true),
      ),
    )
    .orderBy(asc(library_items.order_index));

  const itemsBySubsection = new Map<string, LibraryItemDto[]>();
  const loose: LibraryItemDto[] = [];
  for (const row of items) {
    const dto = mapItem(row);
    if (row.subsection_id) {
      const list = itemsBySubsection.get(row.subsection_id) ?? [];
      list.push(dto);
      itemsBySubsection.set(row.subsection_id, list);
    } else {
      loose.push(dto);
    }
  }

  return {
    id: section.id,
    key: section.key,
    name_en: section.name_en,
    name_hi: section.name_hi,
    name_gu: section.name_gu,
    icon_url: section.icon_url,
    order_index: section.order_index,
    type: section.type,
    deeplink_target: section.deeplink_target,
    requires_login: section.requires_login,
    is_published: section.is_published,
    content_version: section.content_version,
    subsections: subsections.map((row) =>
      mapSubsection(row, itemsBySubsection.get(row.id) ?? []),
    ),
    items: loose,
  };
}

/**
 * One published item — the deep-link unit (GST-PRF-01). Returns null when the
 * item or its section is missing/unpublished, or when `guestOnly` and the
 * section is login-gated: a guest deep link to gated content reads as
 * not-found, never as a content leak.
 */
export async function buildLibraryItem(
  itemId: string,
  opts: BuildLibraryTreeOpts,
): Promise<LibraryItemDto | null> {
  const [row] = await db
    .select({ item: library_items, section: library_sections })
    .from(library_items)
    .innerJoin(library_sections, eq(library_sections.id, library_items.section_id))
    .where(
      and(
        eq(library_items.id, itemId),
        isNull(library_items.deleted_at),
        eq(library_items.is_published, true),
        isNull(library_sections.deleted_at),
        eq(library_sections.is_published, true),
      ),
    )
    .limit(1);

  if (!row) return null;
  if (opts.guestOnly && row.section.requires_login) return null;
  return mapItem(row.item);
}
