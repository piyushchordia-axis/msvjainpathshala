/**
 * Apply a library version-sync plan against React Query cache + downloads.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { LibrarySectionDto } from "@workspace/api-zod";
import { apiGet } from "@/lib/api";
import type { LibraryTreePayload } from "@/lib/library/helpers";
import {
  type LibraryVersionManifest,
  type ManifestScope,
  readLocalManifest,
  writeLocalManifest,
} from "@/lib/library/version-manifest";
import {
  findItemInSection,
  mergeSectionIntoTree,
  planVersionSync,
  pruneGranthDirectory,
  pruneTree,
} from "@/lib/library/version-sync";
import {
  deleteDownloadedAudioWithFile,
  readDownloadedAudio,
} from "@/lib/library/downloaded-audio";
import {
  deleteDownloadedPdfWithFile,
  readDownloadedPdfs,
} from "@/lib/library/downloaded-pdfs";
import { libraryDownloadQueue } from "@/lib/library/download-queue";
import { rebuildLibrarySearchIndex } from "@/lib/library/search-index";
import type { GranthDirectoryDto } from "@workspace/api-zod";
import { fetchGranthDirectory, granthDirectoryKey } from "@/lib/library/granth";

export type RunLibraryVersionSyncOpts = {
  queryClient: QueryClient;
  scope: ManifestScope;
  /** Stop playback when pruning the current track. */
  onPruneItem?: (itemId: string) => void;
};

async function fetchManifest(scope: ManifestScope): Promise<LibraryVersionManifest> {
  const path =
    scope === "member" ? "/v1/library/manifest" : "/v1/public/library/manifest";
  return apiGet<LibraryVersionManifest>(path);
}

async function fetchSection(
  scope: ManifestScope,
  sectionId: string,
): Promise<LibrarySectionDto | null> {
  const path =
    scope === "member"
      ? `/v1/library/sections/${sectionId}`
      : `/v1/public/library/sections/${sectionId}`;
  try {
    const res = await apiGet<{ section: LibrarySectionDto }>(path);
    return res.section;
  } catch {
    return null;
  }
}

export async function runLibraryVersionSync(
  opts: RunLibraryVersionSyncOpts,
): Promise<void> {
  const { queryClient, scope, onPruneItem } = opts;
  const queryKey = ["library", scope] as const;

  let server: LibraryVersionManifest;
  try {
    server = await fetchManifest(scope);
  } catch {
    // Offline / error — skip sync this launch.
    return;
  }

  const previous = await readLocalManifest(scope);
  const tree = queryClient.getQueryData<LibraryTreePayload>(queryKey);
  const downloads = await readDownloadedAudio();
  const pdfDownloads = await readDownloadedPdfs();
  // §17.7 — a downloaded PDF whose content_version moved is as stale as an
  // MP3, and an id the manifest no longer lists must lose its local file
  // whichever store holds it.
  const downloadedItemIds = [
    ...new Set([...downloads.map((d) => d.itemId), ...pdfDownloads.map((d) => d.itemId)]),
  ];

  const plan = planVersionSync({
    previous,
    server,
    tree,
    downloadedItemIds,
  });

  if (plan.isBaseline) {
    await writeLocalManifest(scope, server);
    const baselineTree = queryClient.getQueryData<LibraryTreePayload>(queryKey);
    if (baselineTree) {
      try {
        const directory = await syncGranthDirectory(queryClient, baselineTree);
        await rebuildLibrarySearchIndex(baselineTree, directory);
      } catch {
        /* search index is best-effort */
      }
    }
    return;
  }

  let nextTree = tree ?? { sections: [] };

  if (plan.removedSectionIds.length > 0 || plan.removedItemIds.length > 0) {
    nextTree = pruneTree(
      nextTree,
      new Set(plan.removedSectionIds),
      new Set(plan.removedItemIds),
    );
  }

  // Persist prune immediately; defer text clear until section refetch succeeds
  // so a failed refetch cannot leave items permanently without text.
  queryClient.setQueryData(queryKey, nextTree);

  for (const itemId of plan.removedItemIds) {
    onPruneItem?.(itemId);
    try {
      await libraryDownloadQueue.cancel(itemId);
    } catch {
      /* ignore */
    }
    await deleteDownloadedAudioWithFile(itemId);
    await deleteDownloadedPdfWithFile(itemId);
  }

  const refetchIds = [...plan.sectionsToRefetch];
  const mergedForRefresh = new Map<string, ReturnType<typeof findItemInSection>>();
  const refetchedOk = new Set<string>();

  for (const sectionId of refetchIds) {
    const section = await fetchSection(scope, sectionId);
    if (!section) continue;
    refetchedOk.add(sectionId);
    nextTree = mergeSectionIntoTree(nextTree, section);
    queryClient.setQueryData(queryKey, nextTree);
    for (const itemId of plan.downloadsToRefresh) {
      const item = findItemInSection(section, itemId);
      if (item) mergedForRefresh.set(itemId, item);
    }
  }

  const pdfIds = new Set(pdfDownloads.map((d) => d.itemId));
  const audioIds = new Set(downloads.map((d) => d.itemId));
  for (const itemId of plan.downloadsToRefresh) {
    const item = mergedForRefresh.get(itemId);
    if (!item) continue;
    if (audioIds.has(itemId) && item.audio_url) {
      await libraryDownloadQueue.enqueue(item);
    }
    // Silent re-download: the reader asked for this granth once, and a
    // corrected scan should reach them without a prompt they have to answer.
    if (pdfIds.has(itemId) && item.pdf_url) {
      await libraryDownloadQueue.refreshStalePdf(item);
    }
  }

  await libraryDownloadQueue.reloadFromStorage();
  // Do not advance the local manifest if any section refetch failed — otherwise
  // cleared/missing text never heals until the next content_version bump.
  if (refetchIds.every((id) => refetchedOk.has(id))) {
    await writeLocalManifest(scope, server);
  }

  try {
    // §17.7 — removals first, and applied to the CACHE rather than waiting
    // on a refetch: an unpublished library must stop being offered even if
    // the device is offline when it learns about it.
    const pruned = pruneCachedGranthDirectory(
      queryClient,
      nextTree,
      plan.removedGranthLibraryIds,
      plan.removedGranthEntryIds,
    );
    // Then refetch, but only when versions actually moved. Merging into the
    // same cache key — the whole cache is never invalidated.
    const directory = plan.granthChanged
      ? await syncGranthDirectory(queryClient, nextTree)
      : pruned;
    // Any manifest-detected change rebuilds the index, which is what
    // de-indexes the removed rows.
    await rebuildLibrarySearchIndex(nextTree, directory);
  } catch {
    /* search index is best-effort */
  }
}

function granthSectionId(tree: LibraryTreePayload | undefined): string | null {
  return (tree?.sections ?? []).find((s) => s.type === "granth")?.id ?? null;
}

/**
 * Drop de-listed granth rows from the cached directory in place. Returns the
 * cached payload either way so the caller can hand it to the index rebuild.
 */
function pruneCachedGranthDirectory(
  queryClient: QueryClient,
  tree: LibraryTreePayload | undefined,
  removedLibraryIds: string[],
  removedEntryIds: string[],
): GranthDirectoryDto | null {
  const sectionId = granthSectionId(tree);
  if (!sectionId) return null;
  const cached = queryClient.getQueryData<GranthDirectoryDto>(
    granthDirectoryKey(sectionId),
  );
  if (!cached) return null;
  const next = pruneGranthDirectory(
    cached,
    new Set(removedLibraryIds),
    new Set(removedEntryIds),
  );
  if (next !== cached) queryClient.setQueryData(granthDirectoryKey(sectionId), next);
  return next;
}

function cachedGranthDirectory(
  queryClient: QueryClient,
  tree: LibraryTreePayload | undefined,
): GranthDirectoryDto | null {
  const sectionId = granthSectionId(tree);
  if (!sectionId) return null;
  return queryClient.getQueryData<GranthDirectoryDto>(granthDirectoryKey(sectionId)) ?? null;
}

/**
 * Refetch the directory and write it into the same cache the screens read.
 * Falls back to whatever is already cached: a failed refresh must leave the
 * reader with the old directory, not with none.
 */
async function syncGranthDirectory(
  queryClient: QueryClient,
  tree: LibraryTreePayload | undefined,
): Promise<GranthDirectoryDto | null> {
  const sectionId = granthSectionId(tree);
  if (!sectionId) return null;
  try {
    const directory = await fetchGranthDirectory(sectionId);
    queryClient.setQueryData(granthDirectoryKey(sectionId), directory);
    return directory;
  } catch {
    return cachedGranthDirectory(queryClient, tree);
  }
}
