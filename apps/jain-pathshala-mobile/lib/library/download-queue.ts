/**
 * Library download queue — audio and PDF on one scheduler, max 3 concurrent
 * jobs OVERALL (v3 §17.4).
 *
 * One queue rather than two: three audio downloads plus three PDFs is six
 * simultaneous transfers on a centre's shared wifi, which is exactly the
 * saturation the cap exists to prevent. The two kinds keep separate local
 * stores (DownloadedAudio / DownloadedPdf) because their records differ —
 * a PDF carries lastReadPage and a page count — but they contend for the
 * same three slots and share the same background/resume behaviour.
 */
import { AppState, Platform, type AppStateStatus } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import type { LibraryItemDto } from "@workspace/api-zod";
import { safeHref } from "@/lib/safe-url";
import { apiGet, resolveUploadUrl } from "@/lib/api";
import { reportLibraryAccess } from "@/lib/library/access-log";
import {
  downloadKey as progressKey,
  pickNextDownloads,
  type DownloadKind,
} from "@/lib/library/download-schedule";
import {
  type DownloadedAudio,
  ensureLibraryAudioDir,
  libraryAudioPath,
  readDownloadedAudio,
  removeDownloadedAudio,
  upsertDownloadedAudio,
} from "@/lib/library/downloaded-audio";
import {
  type DownloadedPdf,
  ensureLibraryPdfDir,
  libraryPdfPath,
  readDownloadedPdfs,
  removeDownloadedPdf,
  upsertDownloadedPdf,
} from "@/lib/library/downloaded-pdfs";

const MAX_CONCURRENT = 3;

export type { DownloadKind } from "@/lib/library/download-schedule";

type ProgressMap = Record<string, number>;
type Listener = () => void;

type ActiveJob = {
  key: string;
  /**
   * Null while the slot is reserved but the transfer has not started —
   * a PDF job fetches a fresh signed URL first, and without holding the
   * slot across that await the scheduler would start a fourth download.
   */
  task: FileSystem.DownloadResumable | null;
};



/**
 * §17.4 — a fresh signed URL at download time (1h TTL), never the copy cached
 * in the tree. The tree can sit in AsyncStorage for days; its signature will
 * have expired long before the reader taps download, and the failure would look
 * like a broken file rather than a stale link.
 */
async function freshPdfUrl(itemId: string): Promise<string | null> {
  type ItemEnvelope = { item: LibraryItemDto };
  for (const path of [`/v1/library/items/${itemId}`, `/v1/public/library/items/${itemId}`]) {
    try {
      const res = await apiGet<ItemEnvelope>(path);
      if (res?.item?.pdf_url) return res.item.pdf_url;
    } catch {
      // Member feed 401s for a guest; public 404s for a gated item. Try both
      // before giving up rather than guessing at the session state here.
    }
  }
  return null;
}

class LibraryDownloadQueue {
  private rows: DownloadedAudio[] = [];
  private pdfRows: DownloadedPdf[] = [];
  private progress: ProgressMap = {};
  private active = new Map<string, ActiveJob>();
  private listeners = new Set<Listener>();
  private draining = false;
  private appSub: { remove: () => void } | null = null;
  private itemLookup: ((itemId: string) => LibraryItemDto | null) | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  getSnapshot() {
    return {
      rows: this.rows,
      pdfRows: this.pdfRows,
      progress: { ...this.progress },
    };
  }

  setItemLookup(fn: (itemId: string) => LibraryItemDto | null) {
    this.itemLookup = fn;
  }

  async reloadFromStorage() {
    this.rows = await readDownloadedAudio();
    this.pdfRows = await readDownloadedPdfs();
    this.emit();
  }

  async init() {
    if (Platform.OS === "web") {
      await this.reloadFromStorage();
      return;
    }
    await ensureLibraryAudioDir();
    await ensureLibraryPdfDir();
    this.rows = await readDownloadedAudio();
    this.pdfRows = await readDownloadedPdfs();
    // Incomplete jobs from a prior session become queued for resume.
    for (const row of this.rows) {
      if (row.status === "downloading") {
        await upsertDownloadedAudio({ ...row, status: "queued" });
      }
    }
    for (const row of this.pdfRows) {
      if (row.status === "downloading") {
        await upsertDownloadedPdf({ ...row, status: "queued" });
      }
    }
    await this.reloadFromStorage();
    if (!this.appSub) {
      this.appSub = AppState.addEventListener("change", this.onAppState);
    }
    void this.drain();
  }

  private onAppState = (state: AppStateStatus) => {
    if (state === "active") void this.drain();
  };

  private async refreshRows() {
    await this.reloadFromStorage();
  }

  getRow(itemId: string): DownloadedAudio | undefined {
    return this.rows.find((r) => r.itemId === itemId);
  }

  getPdfRow(itemId: string): DownloadedPdf | undefined {
    return this.pdfRows.find((r) => r.itemId === itemId);
  }

  getProgress(itemId: string): number {
    return this.progress[progressKey("audio", itemId)] ?? 0;
  }

  getPdfProgress(itemId: string): number {
    return this.progress[progressKey("pdf", itemId)] ?? 0;
  }

  /* ── Audio ──────────────────────────────────────────────────────────────── */

  async enqueue(item: LibraryItemDto): Promise<void> {
    if (Platform.OS === "web") return;
    if (!item.audio_url) return;
    const dest = libraryAudioPath(item.id);
    const existing = this.getRow(item.id);
    if (
      existing?.status === "complete" &&
      existing.contentVersion === item.content_version
    ) {
      return;
    }
    // Replace stale/failed/partial file.
    try {
      await FileSystem.deleteAsync(dest, { idempotent: true });
    } catch {
      /* ignore */
    }
    await ensureLibraryAudioDir();
    await upsertDownloadedAudio({
      itemId: item.id,
      localPath: dest,
      sizeBytes: item.audio_size_bytes ?? 0,
      contentVersion: item.content_version,
      downloadedAt: new Date().toISOString(),
      status: "queued",
      title_en: item.title_en ?? "",
      title_hi: item.title_hi ?? "",
      title_gu: item.title_gu ?? "",
      resumeData: null,
      audioUrl: item.audio_url,
    });
    this.progress[progressKey("audio", item.id)] = 0;
    await this.refreshRows();
    void this.drain();
  }

  async cancel(itemId: string): Promise<void> {
    await this.cancelJob("audio", itemId);
    const row = this.getRow(itemId);
    try {
      await FileSystem.deleteAsync(row?.localPath ?? libraryAudioPath(itemId), {
        idempotent: true,
      });
    } catch {
      /* ignore */
    }
    await removeDownloadedAudio(itemId);
    await this.refreshRows();
    void this.drain();
  }

  async retry(itemId: string): Promise<void> {
    const fromCache = this.itemLookup?.(itemId) ?? null;
    const row = this.getRow(itemId);
    if (fromCache?.audio_url) {
      await this.enqueue(fromCache);
      return;
    }
    if (row?.audioUrl) {
      await this.enqueue(
        stubItem(itemId, row.contentVersion, {
          title_en: row.title_en,
          title_hi: row.title_hi,
          title_gu: row.title_gu,
          audio_url: row.audioUrl,
          audio_size_bytes: row.sizeBytes || null,
        }),
      );
    }
  }

  /* ── PDF (v3 §17.11.2) ──────────────────────────────────────────────────── */

  async enqueuePdf(item: LibraryItemDto): Promise<void> {
    if (Platform.OS === "web") return;
    // No pdf_url means no PDF modality on this item; nothing to queue.
    if (!item.pdf_url) return;
    const dest = libraryPdfPath(item.id);
    const existing = this.getPdfRow(item.id);
    if (
      existing?.status === "complete" &&
      existing.contentVersion === item.content_version
    ) {
      return;
    }
    try {
      await FileSystem.deleteAsync(dest, { idempotent: true });
    } catch {
      /* ignore */
    }
    await ensureLibraryPdfDir();
    await upsertDownloadedPdf({
      itemId: item.id,
      localPath: dest,
      sizeBytes: item.pdf_size_bytes ?? 0,
      contentVersion: item.content_version,
      downloadedAt: new Date().toISOString(),
      status: "queued",
      // Carried over when this is a re-download of a version the reader was
      // already partway through — losing their place to a content bump would
      // punish them for the library improving.
      lastReadPage: existing?.lastReadPage ?? 1,
      pageCount: item.pdf_page_count ?? null,
      title_en: item.title_en ?? "",
      title_hi: item.title_hi ?? "",
      title_gu: item.title_gu ?? "",
      resumeData: null,
      pdfUrl: item.pdf_url,
    });
    this.progress[progressKey("pdf", item.id)] = 0;
    await this.refreshRows();
    void this.drain();
  }

  async cancelPdf(itemId: string): Promise<void> {
    await this.cancelJob("pdf", itemId);
    const row = this.getPdfRow(itemId);
    try {
      await FileSystem.deleteAsync(row?.localPath ?? libraryPdfPath(itemId), {
        idempotent: true,
      });
    } catch {
      /* ignore */
    }
    await removeDownloadedPdf(itemId);
    await this.refreshRows();
    void this.drain();
  }

  async retryPdf(itemId: string): Promise<void> {
    const fromCache = this.itemLookup?.(itemId) ?? null;
    const row = this.getPdfRow(itemId);
    if (fromCache?.pdf_url) {
      await this.enqueuePdf(fromCache);
      return;
    }
    if (row?.pdfUrl) {
      await this.enqueuePdf(
        stubItem(itemId, row.contentVersion, {
          title_en: row.title_en,
          title_hi: row.title_hi,
          title_gu: row.title_gu,
          pdf_url: row.pdfUrl,
          pdf_size_bytes: row.sizeBytes || null,
          pdf_page_count: row.pageCount,
        }),
      );
    }
  }

  /**
   * Manifest sync found a newer content_version for a PDF the reader already
   * has (§17.7). Silent: no prompt, no progress chrome stealing focus — they
   * asked for this granth once and should keep having it.
   */
  async refreshStalePdf(item: LibraryItemDto): Promise<void> {
    const row = this.getPdfRow(item.id);
    if (!row) return;
    await this.enqueuePdf(item);
  }

  /* ── Shared scheduler ───────────────────────────────────────────────────── */

  private async cancelJob(kind: DownloadKind, itemId: string): Promise<void> {
    const key = progressKey(kind, itemId);
    const job = this.active.get(key);
    if (job) {
      try {
        // May still be a reservation with no transfer behind it yet.
        await job.task?.cancelAsync();
      } catch {
        /* ignore */
      }
      this.active.delete(key);
    }
    delete this.progress[key];
  }

  private async drain() {
    if (Platform.OS === "web") return;
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const next = pickNextDownloads({
          audio: this.rows,
          pdf: this.pdfRows,
          activeKeys: this.active.keys(),
          max: MAX_CONCURRENT,
        })[0];
        if (!next) break;

        const key = progressKey(next.kind, next.itemId);
        // Reserve the slot BEFORE awaiting anything. A PDF job fetches a
        // fresh signed URL first, and without the reservation the loop
        // starts a fourth transfer while that request is in flight.
        this.active.set(key, { key, task: null });

        if (next.kind === "audio") {
          const row = this.rows.find((r) => r.itemId === next.itemId);
          if (!row) {
            this.active.delete(key);
            break;
          }
          void this.startAudioJob(row);
          await upsertDownloadedAudio({ ...row, status: "downloading" });
        } else {
          const row = this.pdfRows.find((r) => r.itemId === next.itemId);
          if (!row) {
            this.active.delete(key);
            break;
          }
          void this.startPdfJob(row);
          await upsertDownloadedPdf({ ...row, status: "downloading" });
        }
        await this.refreshRows();
      }
    } finally {
      this.draining = false;
    }
  }

  private makeProgressCallback(kind: DownloadKind, itemId: string) {
    const cb: FileSystem.FileSystemNetworkTaskProgressCallback<
      FileSystem.DownloadProgressData
    > = (data) => {
      const total = data.totalBytesExpectedToWrite || 0;
      const written = data.totalBytesWritten || 0;
      this.progress[progressKey(kind, itemId)] =
        total > 0 ? Math.min(1, written / total) : 0;
      this.emit();
    };
    return cb;
  }

  private async startAudioJob(row: DownloadedAudio) {
    const key = progressKey("audio", row.itemId);
    // Prefer device-reachable host (localhost → Metro LAN) for physical iOS.
    const url = resolveUploadUrl(row.audioUrl) ?? safeHref(row.audioUrl) ?? null;
    if (!url) {
      this.active.delete(key);
      await upsertDownloadedAudio({ ...row, status: "failed" });
      await this.refreshRows();
      void this.drain();
      return;
    }

    const dest = row.localPath || libraryAudioPath(row.itemId);
    await ensureLibraryAudioDir();

    const task = FileSystem.createDownloadResumable(
      url,
      dest,
      {},
      this.makeProgressCallback("audio", row.itemId),
      row.resumeData ?? undefined,
    );
    this.active.set(key, { key, task });

    try {
      const result = row.resumeData ? await task.resumeAsync() : await task.downloadAsync();
      this.active.delete(key);
      if (!result?.uri) {
        await upsertDownloadedAudio({ ...row, status: "failed", resumeData: null });
        delete this.progress[key];
        await this.refreshRows();
        void this.drain();
        return;
      }
      const sizeBytes = (await fileSize(result.uri)) ?? row.sizeBytes;
      this.progress[key] = 1;
      await upsertDownloadedAudio({
        ...row,
        localPath: result.uri,
        sizeBytes,
        status: "complete",
        downloadedAt: new Date().toISOString(),
        resumeData: null,
      });
      delete this.progress[key];
      await this.refreshRows();
    } catch {
      this.active.delete(key);
      const resumeData = savableResume(task);
      await upsertDownloadedAudio({
        ...row,
        status: resumeData ? "queued" : "failed",
        resumeData,
      });
      if (!resumeData) delete this.progress[key];
      await this.refreshRows();
    }
    void this.drain();
  }

  private async startPdfJob(row: DownloadedPdf) {
    const key = progressKey("pdf", row.itemId);
    const signed = (await freshPdfUrl(row.itemId)) ?? row.pdfUrl;
    const url = resolveUploadUrl(signed) ?? safeHref(signed) ?? null;
    if (!url) {
      this.active.delete(key);
      await upsertDownloadedPdf({ ...row, status: "failed" });
      await this.refreshRows();
      void this.drain();
      return;
    }

    const dest = row.localPath || libraryPdfPath(row.itemId);
    await ensureLibraryPdfDir();

    const task = FileSystem.createDownloadResumable(
      url,
      dest,
      {},
      this.makeProgressCallback("pdf", row.itemId),
      row.resumeData ?? undefined,
    );
    this.active.set(key, { key, task });

    try {
      const result = row.resumeData ? await task.resumeAsync() : await task.downloadAsync();
      this.active.delete(key);
      if (!result?.uri) {
        await upsertDownloadedPdf({ ...row, status: "failed", resumeData: null });
        delete this.progress[key];
        await this.refreshRows();
        void this.drain();
        return;
      }
      const sizeBytes = (await fileSize(result.uri)) ?? row.sizeBytes;
      this.progress[key] = 1;
      await upsertDownloadedPdf({
        ...row,
        localPath: result.uri,
        sizeBytes,
        // Keep the fresh URL: retry after a failure can reuse it while it lasts.
        pdfUrl: signed,
        status: "complete",
        downloadedAt: new Date().toISOString(),
        resumeData: null,
      });
      delete this.progress[key];
      await this.refreshRows();
      // §17.9 — pdf_download is logged on COMPLETION, not on tap: a cancelled
      // or failed transfer is not a download.
      reportLibraryAccess({ itemId: row.itemId }, "pdf_download");
    } catch {
      this.active.delete(key);
      const resumeData = savableResume(task);
      await upsertDownloadedPdf({
        ...row,
        status: resumeData ? "queued" : "failed",
        resumeData,
      });
      if (!resumeData) delete this.progress[key];
      await this.refreshRows();
    }
    void this.drain();
  }
}

async function fileSize(uri: string): Promise<number | null> {
  try {
    if (Platform.OS === "web") return null;
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && "size" in info && typeof info.size === "number") return info.size;
  } catch {
    /* keep prior */
  }
  return null;
}

function savableResume(task: FileSystem.DownloadResumable): string | null {
  try {
    return task.savable().resumeData ?? null;
  } catch {
    return null;
  }
}

/** Minimal LibraryItemDto for a retry driven by the local record alone. */
function stubItem(
  itemId: string,
  contentVersion: number,
  over: Partial<LibraryItemDto>,
): LibraryItemDto {
  return {
    id: itemId,
    section_id: "",
    subsection_id: null,
    item_code: itemId,
    title_en: "",
    title_hi: null,
    title_gu: null,
    order_index: 0,
    audio_url: null,
    audio_size_bytes: null,
    audio_duration_sec: null,
    youtube_url: null,
    text_content_en: null,
    text_content_hi: null,
    text_content_gu: null,
    tarj_en: null,
    tarj_hi: null,
    pdf_url: null,
    pdf_size_bytes: null,
    pdf_page_count: null,
    external_url: null,
    content_version: contentVersion,
    is_published: true,
    ...over,
  };
}

export const libraryDownloadQueue = new LibraryDownloadQueue();
