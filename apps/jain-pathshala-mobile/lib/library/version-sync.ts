/**
 * Pure helpers for library content-version cold-start sync.
 */
import type {
  GranthDirectoryDto,
  LibraryItemDto,
  LibrarySectionDto,
} from "@workspace/api-zod";
import type { LibraryTreePayload } from "@/lib/library/helpers";
import type { LibraryVersionManifest } from "@/lib/library/version-manifest";

export type VersionSyncPlan = {
  /** First run — only persist snapshot, no refetch/prune. */
  isBaseline: boolean;
  /** Section ids to drop from the tree. */
  removedSectionIds: string[];
  /** Item ids to remove from tree + local audio. */
  removedItemIds: string[];
  /** Item ids whose text must be cleared until section refetch. */
  staleItemIds: string[];
  /** Section ids to refetch and merge. */
  sectionsToRefetch: string[];
  /**
   * Downloaded item ids to silently re-enqueue after merge — audio, PDF, or
   * both (§17.7). Named for what it is rather than for audio: a downloaded
   * PDF whose content_version moved is just as stale as an MP3, and the
   * caller is the one that knows which local stores hold the id.
   */
  downloadsToRefresh: string[];
  /**
   * §17.7 — granth ids the manifest no longer lists. Removed from the
   * cached directory and de-indexed WITHOUT waiting for a refetch: an
   * unpublished library must stop being offered even if the device is
   * offline when it finds out.
   */
  removedGranthLibraryIds: string[];
  removedGranthEntryIds: string[];
  /**
   * True when any granth row appeared or moved version. The directory is
   * fetched as one payload, so this drives a single refetch rather than a
   * per-row one — the same rule as sections, applied at the payload's own
   * granularity.
   */
  granthChanged: boolean;
};

/** Ids the previous snapshot knew and the server no longer lists. */
function missingIds(
  previous: Record<string, number> | undefined,
  server: Record<string, number> | undefined,
): string[] {
  const b = server ?? {};
  return Object.keys(previous ?? {}).filter((id) => b[id] == null);
}

/**
 * True when any id appeared, disappeared, or moved version. Additions and
 * removals both count: a newly published library must show up without
 * waiting for an unrelated edit, and an unpublished one must leave.
 */
function versionMapChanged(
  previous: Record<string, number> | undefined,
  server: Record<string, number> | undefined,
): boolean {
  const a = previous ?? {};
  const b = server ?? {};
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return true;
  for (const key of bKeys) {
    if (a[key] !== b[key]) return true;
  }
  return false;
}

function collectTreeItemIds(tree: LibraryTreePayload | undefined): Set<string> {
  const ids = new Set<string>();
  if (!tree) return ids;
  for (const section of tree.sections) {
    for (const sub of section.subsections ?? []) {
      for (const item of sub.items ?? []) ids.add(item.id);
    }
    for (const item of section.items ?? []) ids.add(item.id);
  }
  return ids;
}

function collectTreeSectionIds(tree: LibraryTreePayload | undefined): Set<string> {
  return new Set((tree?.sections ?? []).map((s) => s.id));
}

function findItemSectionId(
  tree: LibraryTreePayload | undefined,
  itemId: string,
): string | null {
  if (!tree) return null;
  for (const section of tree.sections) {
    for (const sub of section.subsections ?? []) {
      if ((sub.items ?? []).some((i) => i.id === itemId)) return section.id;
    }
    if ((section.items ?? []).some((i) => i.id === itemId)) return section.id;
  }
  return null;
}

/**
 * Diff previous local snapshot + current tree against the server manifest.
 * `downloadedItemIds` = every locally downloaded item id (audio and PDF).
 */
export function planVersionSync(args: {
  previous: LibraryVersionManifest | null;
  server: LibraryVersionManifest;
  tree: LibraryTreePayload | undefined;
  downloadedItemIds: string[];
}): VersionSyncPlan {
  const { previous, server, tree, downloadedItemIds } = args;

  if (!previous) {
    return {
      isBaseline: true,
      removedSectionIds: [],
      removedItemIds: [],
      staleItemIds: [],
      sectionsToRefetch: [],
      downloadsToRefresh: [],
      removedGranthLibraryIds: [],
      removedGranthEntryIds: [],
      // Baseline: nothing to compare against, so the caller loads the
      // directory fresh rather than treating it as unchanged.
      granthChanged: true,
    };
  }

  const treeItemIds = collectTreeItemIds(tree);
  const treeSectionIds = collectTreeSectionIds(tree);
  const serverItemIds = new Set(Object.keys(server.items));
  const serverSectionIds = new Set(Object.keys(server.sections));

  const removedItemIds: string[] = [];
  for (const id of treeItemIds) {
    if (!serverItemIds.has(id)) removedItemIds.push(id);
  }
  for (const id of downloadedItemIds) {
    if (!serverItemIds.has(id) && !removedItemIds.includes(id)) {
      removedItemIds.push(id);
    }
  }

  const removedSectionIds: string[] = [];
  for (const id of treeSectionIds) {
    if (!serverSectionIds.has(id)) removedSectionIds.push(id);
  }

  const staleItemIds: string[] = [];
  const sectionsToRefetch = new Set<string>();
  const downloadsToRefresh: string[] = [];

  for (const [itemId, serverVer] of Object.entries(server.items)) {
    const prevVer = previous.items[itemId];
    if (prevVer == null) continue;
    if (serverVer > prevVer) {
      staleItemIds.push(itemId);
      const sectionId = findItemSectionId(tree, itemId);
      if (sectionId) sectionsToRefetch.add(sectionId);
      if (downloadedItemIds.includes(itemId)) {
        downloadsToRefresh.push(itemId);
      }
    }
  }

  for (const [sectionId, serverVer] of Object.entries(server.sections)) {
    const prevVer = previous.sections[sectionId];
    if (prevVer == null) continue;
    if (serverVer > prevVer) {
      sectionsToRefetch.add(sectionId);
    }
  }

  // Drop refetch for sections we're removing entirely.
  for (const id of removedSectionIds) {
    sectionsToRefetch.delete(id);
  }

  return {
    isBaseline: false,
    removedSectionIds,
    removedItemIds,
    staleItemIds,
    sectionsToRefetch: [...sectionsToRefetch],
    downloadsToRefresh,
    removedGranthLibraryIds: missingIds(previous.granth_libraries, server.granth_libraries),
    removedGranthEntryIds: missingIds(previous.granth_entries, server.granth_entries),
    granthChanged:
      versionMapChanged(previous.granth_libraries, server.granth_libraries) ||
      versionMapChanged(previous.granth_entries, server.granth_entries),
  };
}

/** Clear text bodies on matching items (in-place clone). */
export function clearItemTextInTree(
  tree: LibraryTreePayload,
  itemIds: Set<string>,
): LibraryTreePayload {
  if (itemIds.size === 0) return tree;
  return {
    sections: tree.sections.map((section) => ({
      ...section,
      subsections: (section.subsections ?? []).map((sub) => ({
        ...sub,
        items: (sub.items ?? []).map((item) =>
          itemIds.has(item.id) ? clearText(item) : item,
        ),
      })),
      items: (section.items ?? []).map((item) =>
        itemIds.has(item.id) ? clearText(item) : item,
      ),
    })),
  };
}

function clearText(item: LibraryItemDto): LibraryItemDto {
  return {
    ...item,
    text_content_en: null,
    text_content_hi: null,
    text_content_gu: null,
  };
}

/**
 * §17.7 — drop granth rows the manifest no longer lists, and every
 * availability join that pointed at one.
 *
 * Returns the same object when nothing is removed so callers can skip a
 * pointless cache write. Never clears the payload: an unpublished library
 * must not take the rest of the directory with it.
 */
export function pruneGranthDirectory(
  directory: GranthDirectoryDto,
  removedLibraryIds: Set<string>,
  removedEntryIds: Set<string>,
): GranthDirectoryDto {
  if (removedLibraryIds.size === 0 && removedEntryIds.size === 0) return directory;
  return {
    libraries: directory.libraries.filter((l) => !removedLibraryIds.has(l.id)),
    entries: directory.entries.filter((e) => !removedEntryIds.has(e.id)),
    availability: directory.availability.filter(
      (a) => !removedLibraryIds.has(a.library_id) && !removedEntryIds.has(a.granth_id),
    ),
  };
}

export function pruneTree(
  tree: LibraryTreePayload,
  removedSectionIds: Set<string>,
  removedItemIds: Set<string>,
): LibraryTreePayload {
  const sections = tree.sections
    .filter((s) => !removedSectionIds.has(s.id))
    .map((section) => ({
      ...section,
      subsections: (section.subsections ?? []).map((sub) => ({
        ...sub,
        items: (sub.items ?? []).filter((i) => !removedItemIds.has(i.id)),
      })),
      items: (section.items ?? []).filter((i) => !removedItemIds.has(i.id)),
    }));
  return { sections };
}

export function mergeSectionIntoTree(
  tree: LibraryTreePayload,
  section: LibrarySectionDto,
): LibraryTreePayload {
  const idx = tree.sections.findIndex((s) => s.id === section.id);
  if (idx < 0) {
    return { sections: [...tree.sections, section] };
  }
  const sections = [...tree.sections];
  sections[idx] = section;
  return { sections };
}

export function findItemInSection(
  section: LibrarySectionDto,
  itemId: string,
): LibraryItemDto | null {
  for (const sub of section.subsections ?? []) {
    const hit = (sub.items ?? []).find((i) => i.id === itemId);
    if (hit) return hit;
  }
  return (section.items ?? []).find((i) => i.id === itemId) ?? null;
}
