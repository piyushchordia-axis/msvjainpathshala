/**
 * Library audio download queue — max 3 concurrent FileSystem DownloadResumable jobs.
 */
import { AppState, Platform, type AppStateStatus } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import type { LibraryItemDto } from "@workspace/api-zod";
import { safeHref } from "@/lib/safe-url";
import { resolveUploadUrl } from "@/lib/api";
import {
  type DownloadedAudio,
  ensureLibraryAudioDir,
  libraryAudioPath,
  readDownloadedAudio,
  removeDownloadedAudio,
  upsertDownloadedAudio,
} from "@/lib/library/downloaded-audio";

const MAX_CONCURRENT = 3;

type ProgressMap = Record<string, number>;
type Listener = () => void;

type ActiveJob = {
  itemId: string;
  task: FileSystem.DownloadResumable;
};

class LibraryDownloadQueue {
  private rows: DownloadedAudio[] = [];
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
      progress: { ...this.progress },
    };
  }

  setItemLookup(fn: (itemId: string) => LibraryItemDto | null) {
    this.itemLookup = fn;
  }

  async reloadFromStorage() {
    this.rows = await readDownloadedAudio();
    this.emit();
  }

  async init() {
    if (Platform.OS === "web") {
      this.rows = await readDownloadedAudio();
      this.emit();
      return;
    }
    await ensureLibraryAudioDir();
    this.rows = await readDownloadedAudio();
    // Incomplete jobs from a prior session become queued for resume.
    for (const row of this.rows) {
      if (row.status === "downloading") {
        await upsertDownloadedAudio({ ...row, status: "queued" });
      }
    }
    this.rows = await readDownloadedAudio();
    this.emit();
    if (!this.appSub) {
      this.appSub = AppState.addEventListener("change", this.onAppState);
    }
    void this.drain();
  }

  private onAppState = (state: AppStateStatus) => {
    if (state === "active") void this.drain();
  };

  private async refreshRows() {
    this.rows = await readDownloadedAudio();
    this.emit();
  }

  getRow(itemId: string): DownloadedAudio | undefined {
    return this.rows.find((r) => r.itemId === itemId);
  }

  getProgress(itemId: string): number {
    return this.progress[itemId] ?? 0;
  }

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
    this.progress[item.id] = 0;
    await this.refreshRows();
    void this.drain();
  }

  async cancel(itemId: string): Promise<void> {
    const job = this.active.get(itemId);
    if (job) {
      try {
        await job.task.cancelAsync();
      } catch {
        /* ignore */
      }
      this.active.delete(itemId);
    }
    delete this.progress[itemId];
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
      await this.enqueue({
        id: itemId,
        section_id: "",
        subsection_id: null,
        item_code: itemId,
        title_en: row.title_en,
        title_hi: row.title_hi,
        title_gu: row.title_gu,
        order_index: 0,
        audio_url: row.audioUrl,
        audio_size_bytes: row.sizeBytes || null,
        audio_duration_sec: null,
        youtube_url: null,
        text_content_en: null,
        text_content_hi: null,
        text_content_gu: null,
        content_version: row.contentVersion,
        is_published: true,
      } as LibraryItemDto);
    }
  }

  private async drain() {
    if (Platform.OS === "web") return;
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.active.size < MAX_CONCURRENT) {
        const next = this.rows.find(
          (r) => r.status === "queued" && !this.active.has(r.itemId),
        );
        if (!next) break;
        void this.startJob(next);
        // Mark downloading immediately so we don't pick the same row twice.
        await upsertDownloadedAudio({ ...next, status: "downloading" });
        await this.refreshRows();
      }
    } finally {
      this.draining = false;
    }
  }

  private async startJob(row: DownloadedAudio) {
    // Prefer device-reachable host (localhost → Metro LAN) for physical iOS.
    const url = resolveUploadUrl(row.audioUrl) ?? safeHref(row.audioUrl) ?? null;
    if (!url) {
      await upsertDownloadedAudio({ ...row, status: "failed" });
      await this.refreshRows();
      void this.drain();
      return;
    }

    const dest = row.localPath || libraryAudioPath(row.itemId);
    await ensureLibraryAudioDir();

    const callback: FileSystem.FileSystemNetworkTaskProgressCallback<
      FileSystem.DownloadProgressData
    > = (data) => {
      const total = data.totalBytesExpectedToWrite || 0;
      const written = data.totalBytesWritten || 0;
      this.progress[row.itemId] =
        total > 0 ? Math.min(1, written / total) : 0;
      this.emit();
    };

    const task = FileSystem.createDownloadResumable(
      url,
      dest,
      {},
      callback,
      row.resumeData ?? undefined,
    );
    this.active.set(row.itemId, { itemId: row.itemId, task });

    try {
      const result = row.resumeData
        ? await task.resumeAsync()
        : await task.downloadAsync();
      this.active.delete(row.itemId);
      if (!result?.uri) {
        await upsertDownloadedAudio({ ...row, status: "failed", resumeData: null });
        delete this.progress[row.itemId];
        await this.refreshRows();
        void this.drain();
        return;
      }
      let sizeBytes = row.sizeBytes;
      try {
        if (Platform.OS !== "web") {
          const info = await FileSystem.getInfoAsync(result.uri);
          if (info.exists && "size" in info && typeof info.size === "number") {
            sizeBytes = info.size;
          }
        }
      } catch {
        /* keep prior */
      }
      this.progress[row.itemId] = 1;
      await upsertDownloadedAudio({
        ...row,
        localPath: result.uri,
        sizeBytes,
        status: "complete",
        downloadedAt: new Date().toISOString(),
        resumeData: null,
      });
      delete this.progress[row.itemId];
      await this.refreshRows();
    } catch {
      this.active.delete(row.itemId);
      let resumeData: string | null = null;
      try {
        const savable = task.savable();
        resumeData = savable.resumeData ?? null;
      } catch {
        resumeData = null;
      }
      await upsertDownloadedAudio({
        ...row,
        status: resumeData ? "queued" : "failed",
        resumeData,
      });
      if (!resumeData) delete this.progress[row.itemId];
      await this.refreshRows();
    }
    void this.drain();
  }
}

export const libraryDownloadQueue = new LibraryDownloadQueue();
