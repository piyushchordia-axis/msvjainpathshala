import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LibraryItemDto } from "@workspace/api-zod";
import { findItemInTrees, libraryTreesFromCache } from "@/lib/library/helpers";
import { useLibraryDownload } from "@/contexts/LibraryDownloadContext";

/** Keeps the download queue able to resolve items from the React Query library cache. */
export function LibraryDownloadItemLookup() {
  const qc = useQueryClient();
  const { setItemLookup } = useLibraryDownload();

  useEffect(() => {
    setItemLookup((itemId: string): LibraryItemDto | null => {
      const found = findItemInTrees(libraryTreesFromCache(qc), itemId);
      return found?.item ?? null;
    });
  }, [qc, setItemLookup]);

  return null;
}
