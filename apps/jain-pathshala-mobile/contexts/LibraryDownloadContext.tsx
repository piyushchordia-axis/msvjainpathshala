import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { LibraryItemDto } from "@workspace/api-zod";
import {
  type DownloadedAudio,
  deleteDownloadedAudioWithFile,
  clearAllDownloadedAudioWithFiles,
  sumDownloadedBytes,
} from "@/lib/library/downloaded-audio";
import { libraryDownloadQueue } from "@/lib/library/download-queue";

type LibraryDownloadContextValue = {
  rows: DownloadedAudio[];
  progress: Record<string, number>;
  getRow: (itemId: string) => DownloadedAudio | undefined;
  getProgress: (itemId: string) => number;
  enqueue: (item: LibraryItemDto) => Promise<void>;
  cancel: (itemId: string) => Promise<void>;
  retry: (itemId: string) => Promise<void>;
  remove: (itemId: string) => Promise<void>;
  clearAll: () => Promise<void>;
  totalBytes: number;
  setItemLookup: (fn: (itemId: string) => LibraryItemDto | null) => void;
};

const LibraryDownloadContext = createContext<LibraryDownloadContextValue | null>(null);

export function LibraryDownloadProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<DownloadedAudio[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});

  useEffect(() => {
    void libraryDownloadQueue.init();
    return libraryDownloadQueue.subscribe(() => {
      const snap = libraryDownloadQueue.getSnapshot();
      setRows(snap.rows);
      setProgress(snap.progress);
    });
  }, []);

  const enqueue = useCallback((item: LibraryItemDto) => libraryDownloadQueue.enqueue(item), []);
  const cancel = useCallback((itemId: string) => libraryDownloadQueue.cancel(itemId), []);
  const retry = useCallback((itemId: string) => libraryDownloadQueue.retry(itemId), []);
  const remove = useCallback(async (itemId: string) => {
    if (
      libraryDownloadQueue.getRow(itemId)?.status === "queued" ||
      libraryDownloadQueue.getRow(itemId)?.status === "downloading"
    ) {
      await libraryDownloadQueue.cancel(itemId);
    } else {
      await deleteDownloadedAudioWithFile(itemId);
      await libraryDownloadQueue.reloadFromStorage();
    }
  }, []);
  const clearAll = useCallback(async () => {
    const snapshot = libraryDownloadQueue.getSnapshot().rows;
    for (const row of snapshot) {
      if (row.status === "queued" || row.status === "downloading") {
        await libraryDownloadQueue.cancel(row.itemId);
      }
    }
    await clearAllDownloadedAudioWithFiles();
    await libraryDownloadQueue.reloadFromStorage();
  }, []);
  const setItemLookup = useCallback((fn: (itemId: string) => LibraryItemDto | null) => {
    libraryDownloadQueue.setItemLookup(fn);
  }, []);

  const value = useMemo<LibraryDownloadContextValue>(
    () => ({
      rows,
      progress,
      getRow: (itemId) => rows.find((r) => r.itemId === itemId),
      getProgress: (itemId) => progress[itemId] ?? 0,
      enqueue,
      cancel,
      retry,
      remove,
      clearAll,
      totalBytes: sumDownloadedBytes(rows),
      setItemLookup,
    }),
    [rows, progress, enqueue, cancel, retry, remove, clearAll, setItemLookup],
  );

  return (
    <LibraryDownloadContext.Provider value={value}>{children}</LibraryDownloadContext.Provider>
  );
}

export function useLibraryDownload(): LibraryDownloadContextValue {
  const ctx = useContext(LibraryDownloadContext);
  if (!ctx) {
    throw new Error("useLibraryDownload must be used within LibraryDownloadProvider");
  }
  return ctx;
}

/** Resolve button UI state from download row + item version. */
export type AudioButtonState =
  | "idle"
  | "queued"
  | "downloading"
  | "ready"
  | "failed";

export function resolveAudioButtonState(
  row: DownloadedAudio | undefined,
  contentVersion: number,
): AudioButtonState {
  if (!row) return "idle";
  if (row.status === "queued") return "queued";
  if (row.status === "downloading") return "downloading";
  if (row.status === "failed") return "failed";
  if (row.status === "complete" && row.contentVersion === contentVersion) return "ready";
  return "idle";
}
