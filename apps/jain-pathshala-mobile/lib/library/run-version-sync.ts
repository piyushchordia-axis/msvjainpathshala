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
  pruneTree,
} from "@/lib/library/version-sync";
import {
  deleteDownloadedAudioWithFile,
  readDownloadedAudio,
} from "@/lib/library/downloaded-audio";
import { libraryDownloadQueue } from "@/lib/library/download-queue";
import { rebuildLibrarySearchIndex } from "@/lib/library/search-index";

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
  const downloadedItemIds = downloads.map((d) => d.itemId);

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
        await rebuildLibrarySearchIndex(baselineTree);
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
  }

  const refetchIds = [...plan.sectionsToRefetch];
  const mergedItemsForAudio = new Map<string, ReturnType<typeof findItemInSection>>();
  const refetchedOk = new Set<string>();

  for (const sectionId of refetchIds) {
    const section = await fetchSection(scope, sectionId);
    if (!section) continue;
    refetchedOk.add(sectionId);
    nextTree = mergeSectionIntoTree(nextTree, section);
    queryClient.setQueryData(queryKey, nextTree);
    for (const itemId of plan.audioToRedownload) {
      const item = findItemInSection(section, itemId);
      if (item) mergedItemsForAudio.set(itemId, item);
    }
  }

  for (const itemId of plan.audioToRedownload) {
    const item = mergedItemsForAudio.get(itemId);
    if (item?.audio_url) {
      await libraryDownloadQueue.enqueue(item);
    }
  }

  await libraryDownloadQueue.reloadFromStorage();
  // Do not advance the local manifest if any section refetch failed — otherwise
  // cleared/missing text never heals until the next content_version bump.
  if (refetchIds.every((id) => refetchedOk.has(id))) {
    await writeLocalManifest(scope, server);
  }

  try {
    await rebuildLibrarySearchIndex(nextTree);
  } catch {
    /* search index is best-effort */
  }
}
