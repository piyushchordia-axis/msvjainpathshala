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
import {
  type DownloadedPdf,
  clearAllDownloadedPdfsWithFiles,
  deleteDownloadedPdfWithFile,
  sumDownloadedPdfBytes,
} from "@/lib/library/downloaded-pdfs";
import { libraryDownloadQueue } from "@/lib/library/download-queue";
import { resolveDownloadButtonState } from "@/lib/library/download-schedule";

type LibraryDownloadContextValue = {
  rows: DownloadedAudio[];
  pdfRows: DownloadedPdf[];
  progress: Record<string, number>;
  getRow: (itemId: string) => DownloadedAudio | undefined;
  getProgress: (itemId: string) => number;
  enqueue: (item: LibraryItemDto) => Promise<void>;
  cancel: (itemId: string) => Promise<void>;
  retry: (itemId: string) => Promise<void>;
  remove: (itemId: string) => Promise<void>;
  getPdfRow: (itemId: string) => DownloadedPdf | undefined;
  getPdfProgress: (itemId: string) => number;
  enqueuePdf: (item: LibraryItemDto) => Promise<void>;
  cancelPdf: (itemId: string) => Promise<void>;
  retryPdf: (itemId: string) => Promise<void>;
  removePdf: (itemId: string) => Promise<void>;
  clearAll: () => Promise<void>;
  /** Audio + PDF together — what the Downloads screen reports as on-device. */
  totalBytes: number;
  audioBytes: number;
  pdfBytes: number;
  setItemLookup: (fn: (itemId: string) => LibraryItemDto | null) => void;
};

const LibraryDownloadContext = createContext<LibraryDownloadContextValue | null>(null);

export function LibraryDownloadProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<DownloadedAudio[]>([]);
  const [pdfRows, setPdfRows] = useState<DownloadedPdf[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});

  useEffect(() => {
    void libraryDownloadQueue.init();
    return libraryDownloadQueue.subscribe(() => {
      const snap = libraryDownloadQueue.getSnapshot();
      setRows(snap.rows);
      setPdfRows(snap.pdfRows);
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
  const enqueuePdf = useCallback(
    (item: LibraryItemDto) => libraryDownloadQueue.enqueuePdf(item),
    [],
  );
  const cancelPdf = useCallback((itemId: string) => libraryDownloadQueue.cancelPdf(itemId), []);
  const retryPdf = useCallback((itemId: string) => libraryDownloadQueue.retryPdf(itemId), []);
  const removePdf = useCallback(async (itemId: string) => {
    const status = libraryDownloadQueue.getPdfRow(itemId)?.status;
    if (status === "queued" || status === "downloading") {
      await libraryDownloadQueue.cancelPdf(itemId);
      return;
    }
    // The reading position goes with the file: it describes a local copy,
    // and a stale page number restored onto a later re-download would drop
    // the reader somewhere they never were.
    await deleteDownloadedPdfWithFile(itemId);
    await libraryDownloadQueue.reloadFromStorage();
  }, []);
  const clearAll = useCallback(async () => {
    const snapshot = libraryDownloadQueue.getSnapshot();
    for (const row of snapshot.rows) {
      if (row.status === "queued" || row.status === "downloading") {
        await libraryDownloadQueue.cancel(row.itemId);
      }
    }
    for (const row of snapshot.pdfRows) {
      if (row.status === "queued" || row.status === "downloading") {
        await libraryDownloadQueue.cancelPdf(row.itemId);
      }
    }
    await clearAllDownloadedAudioWithFiles();
    await clearAllDownloadedPdfsWithFiles();
    await libraryDownloadQueue.reloadFromStorage();
  }, []);
  const setItemLookup = useCallback((fn: (itemId: string) => LibraryItemDto | null) => {
    libraryDownloadQueue.setItemLookup(fn);
  }, []);

  const value = useMemo<LibraryDownloadContextValue>(
    () => ({
      rows,
      pdfRows,
      progress,
      getRow: (itemId) => rows.find((r) => r.itemId === itemId),
      // Progress keys are kind-prefixed in the queue — one item can be
      // fetching its audio and its PDF at the same moment.
      getProgress: (itemId) => progress["audio:" + itemId] ?? 0,
      enqueue,
      cancel,
      retry,
      remove,
      getPdfRow: (itemId) => pdfRows.find((r) => r.itemId === itemId),
      getPdfProgress: (itemId) => progress["pdf:" + itemId] ?? 0,
      enqueuePdf,
      cancelPdf,
      retryPdf,
      removePdf,
      clearAll,
      totalBytes: sumDownloadedBytes(rows) + sumDownloadedPdfBytes(pdfRows),
      audioBytes: sumDownloadedBytes(rows),
      pdfBytes: sumDownloadedPdfBytes(pdfRows),
      setItemLookup,
    }),
    [
      rows,
      pdfRows,
      progress,
      enqueue,
      cancel,
      retry,
      remove,
      enqueuePdf,
      cancelPdf,
      retryPdf,
      removePdf,
      clearAll,
      setItemLookup,
    ],
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

/**
 * Both live in download-schedule.ts (RN-free, unit-tested). Re-exported
 * here because every existing call site imports them from this module.
 */
export const resolveAudioButtonState = resolveDownloadButtonState;
export const resolvePdfButtonState = resolveDownloadButtonState;
