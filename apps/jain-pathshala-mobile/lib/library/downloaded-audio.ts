/**
 * Local-only DownloadedAudio records for library audio offline playback.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

export const LIBRARY_DOWNLOAD_STATUSES = [
  "queued",
  "downloading",
  "complete",
  "failed",
] as const;
export type LibraryDownloadStatus = (typeof LIBRARY_DOWNLOAD_STATUSES)[number];

export type DownloadedAudio = {
  itemId: string;
  localPath: string;
  sizeBytes: number;
  contentVersion: number;
  downloadedAt: string;
  status: LibraryDownloadStatus;
  title_en: string;
  title_hi: string;
  title_gu: string;
  /** Opaque resume token for FileSystem.createDownloadResumable (optional). */
  resumeData?: string | null;
  audioUrl?: string | null;
};

/** Stable AsyncStorage key (same jp.* style as offline queues). */
export const DOWNLOADED_AUDIO_KEY = "jp.library.downloaded_audio";

export function libraryAudioDir(): string {
  return `${FileSystem.documentDirectory ?? ""}library-audio/`;
}

export function libraryAudioPath(itemId: string): string {
  // Must be a real audio extension — iOS AVPlayer often won't decode ".audio".
  return `${libraryAudioDir()}${itemId}.mp3`;
}

export async function ensureLibraryAudioDir(): Promise<void> {
  if (Platform.OS === "web") return;
  const dir = libraryAudioDir();
  if (!dir) return;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export async function readDownloadedAudio(): Promise<DownloadedAudio[]> {
  const raw = await AsyncStorage.getItem(DOWNLOADED_AUDIO_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as DownloadedAudio[]).map(normalizeRow);
  } catch {
    return [];
  }
}

function normalizeRow(row: DownloadedAudio): DownloadedAudio {
  return {
    itemId: row.itemId,
    localPath: row.localPath ?? libraryAudioPath(row.itemId),
    sizeBytes: Number(row.sizeBytes) || 0,
    contentVersion: Number(row.contentVersion) || 0,
    downloadedAt: row.downloadedAt ?? new Date().toISOString(),
    status: LIBRARY_DOWNLOAD_STATUSES.includes(row.status) ? row.status : "failed",
    title_en: row.title_en ?? "",
    title_hi: row.title_hi ?? "",
    title_gu: row.title_gu ?? "",
    resumeData: row.resumeData ?? null,
    audioUrl: row.audioUrl ?? null,
  };
}

export async function writeDownloadedAudio(rows: DownloadedAudio[]): Promise<void> {
  await AsyncStorage.setItem(DOWNLOADED_AUDIO_KEY, JSON.stringify(rows));
}

/** Insert or replace by itemId. */
export async function upsertDownloadedAudio(row: DownloadedAudio): Promise<DownloadedAudio[]> {
  const cur = await readDownloadedAudio();
  const normalized = normalizeRow(row);
  const idx = cur.findIndex((r) => r.itemId === normalized.itemId);
  if (idx >= 0) cur[idx] = normalized;
  else cur.push(normalized);
  await writeDownloadedAudio(cur);
  return cur;
}

export async function getDownloadedAudio(itemId: string): Promise<DownloadedAudio | null> {
  const cur = await readDownloadedAudio();
  return cur.find((r) => r.itemId === itemId) ?? null;
}

export async function removeDownloadedAudio(itemId: string): Promise<DownloadedAudio[]> {
  const next = (await readDownloadedAudio()).filter((r) => r.itemId !== itemId);
  await writeDownloadedAudio(next);
  return next;
}

export async function clearDownloadedAudio(): Promise<void> {
  await AsyncStorage.removeItem(DOWNLOADED_AUDIO_KEY);
}

export function sumDownloadedBytes(rows: DownloadedAudio[]): number {
  return rows
    .filter((r) => r.status === "complete")
    .reduce((acc, r) => acc + (r.sizeBytes || 0), 0);
}

/** Delete local file (if any) and remove the AsyncStorage row. */
export async function deleteDownloadedAudioWithFile(itemId: string): Promise<DownloadedAudio[]> {
  const row = await getDownloadedAudio(itemId);
  const path = row?.localPath || libraryAudioPath(itemId);
  try {
    if (Platform.OS !== "web") {
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists) await FileSystem.deleteAsync(path, { idempotent: true });
    }
  } catch {
    /* ignore missing file */
  }
  return removeDownloadedAudio(itemId);
}

export async function clearAllDownloadedAudioWithFiles(): Promise<void> {
  const rows = await readDownloadedAudio();
  for (const row of rows) {
    try {
      await FileSystem.deleteAsync(row.localPath || libraryAudioPath(row.itemId), {
        idempotent: true,
      });
    } catch {
      /* ignore */
    }
  }
  await clearDownloadedAudio();
}

/** True when a complete download matches the item's content_version and file exists. */
export async function isDownloadCurrent(
  itemId: string,
  contentVersion: number,
): Promise<boolean> {
  const row = await getDownloadedAudio(itemId);
  if (!row || row.status !== "complete") return false;
  if (row.contentVersion !== contentVersion) return false;
  if (Platform.OS === "web") return false;
  try {
    const info = await FileSystem.getInfoAsync(row.localPath);
    return info.exists;
  } catch {
    return false;
  }
}
