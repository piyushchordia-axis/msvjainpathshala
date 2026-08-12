/**
 * Pure helpers for library content-version cold-start sync.
 */
import type { LibraryItemDto, LibrarySectionDto } from "@workspace/api-zod";
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
  /** Downloaded item ids to silently re-enqueue after merge. */
  audioToRedownload: string[];
};

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
 * `downloadedItemIds` = complete (or any) DownloadedAudio itemIds for re-download.
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
      audioToRedownload: [],
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
  const audioToRedownload: string[] = [];

  for (const [itemId, serverVer] of Object.entries(server.items)) {
    const prevVer = previous.items[itemId];
    if (prevVer == null) continue;
    if (serverVer > prevVer) {
      staleItemIds.push(itemId);
      const sectionId = findItemSectionId(tree, itemId);
      if (sectionId) sectionsToRefetch.add(sectionId);
      if (downloadedItemIds.includes(itemId)) {
        audioToRedownload.push(itemId);
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
    audioToRedownload,
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
