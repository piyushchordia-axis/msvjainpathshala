/**
 * Lightweight published library version maps for client cold-start sync.
 */
import { db, library_items, library_sections } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

export type LibraryVersionManifest = {
  sections: Record<string, number>;
  items: Record<string, number>;
};

export type BuildLibraryManifestOpts = {
  guestOnly: boolean;
};

export async function buildLibraryManifest(
  opts: BuildLibraryManifestOpts,
): Promise<LibraryVersionManifest> {
  const sections = await db
    .select({
      id: library_sections.id,
      content_version: library_sections.content_version,
      requires_login: library_sections.requires_login,
    })
    .from(library_sections)
    .where(and(isNull(library_sections.deleted_at), eq(library_sections.is_published, true)));

  const sectionMap: Record<string, number> = {};
  for (const s of sections) {
    sectionMap[s.id] = s.content_version;
  }

  // Guest catalogue includes gated section shells but not their item delivery ids.
  const contentSectionIds = sections
    .filter((s) => !(opts.guestOnly && s.requires_login))
    .map((s) => s.id);

  const itemMap: Record<string, number> = {};
  if (contentSectionIds.length > 0) {
    const items = await db
      .select({
        id: library_items.id,
        content_version: library_items.content_version,
      })
      .from(library_items)
      .where(
        and(
          inArray(library_items.section_id, contentSectionIds),
          isNull(library_items.deleted_at),
          eq(library_items.is_published, true),
        ),
      );
    for (const item of items) {
      itemMap[item.id] = item.content_version;
    }
  }

  return { sections: sectionMap, items: itemMap };
}
