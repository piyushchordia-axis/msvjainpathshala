/**
 * Local-only DownloadedPdf records for granth PDF offline reading.
 *
 * Client-local ONLY — Section 17 v3 Part C lists this under "Client-local only
 * (SQLite — not server)". There is no server table and no sync: `lastReadPage`
 * is deliberately device-local in v1 (v3 Open Decision 6), because reading
 * starts before there is a session to sync it to.
 *
 * Mirrors ./downloaded-audio deliberately — v3 §17.4 puts PDFs and audio on one
 * download queue with the same state machine, the same Downloads screen, and
 * the same signed-URL rule (fresh URL at download time, local file thereafter).
 * Pre-login downloads are device-scoped and re-keyed on first login, never cleared.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

import { LIBRARY_DOWNLOAD_STATUSES, type LibraryDownloadStatus } from "./downloaded-audio";

export type DownloadedPdf = {
  itemId: string;
  localPath: string;
  sizeBytes: number;
  contentVersion: number;
  downloadedAt: string;
  status: LibraryDownloadStatus;
  /** Restored when the viewer reopens; 1-based, 1 until the reader moves. */
  lastReadPage: number;
  pageCount: number | null;
  title_en: string;
  title_hi: string;
  title_gu: string;
  /** Opaque resume token for FileSystem.createDownloadResumable (optional). */
  resumeData?: string | null;
  pdfUrl?: string | null;
};

/** Stable AsyncStorage key (same jp.* style as offline queues). */
export const DOWNLOADED_PDF_KEY = "jp.library.downloaded_pdfs";

export function libraryPdfDir(): string {
  return `${FileSystem.documentDirectory ?? ""}library-pdf/`;
}

export function libraryPdfPath(itemId: string): string {
  // Real .pdf extension — viewers and the OS share sheet both key off it.
  return `${libraryPdfDir()}${itemId}.pdf`;
}

export async function ensureLibraryPdfDir(): Promise<void> {
  if (Platform.OS === "web") return;
  const dir = libraryPdfDir();
  if (!dir) return;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

export async function readDownloadedPdfs(): Promise<DownloadedPdf[]> {
  const raw = await AsyncStorage.getItem(DOWNLOADED_PDF_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as DownloadedPdf[]).map(normalizeRow);
  } catch {
    return [];
  }
}

function normalizeRow(row: DownloadedPdf): DownloadedPdf {
  const pageCount = Number(row.pageCount);
  return {
    itemId: row.itemId,
    localPath: row.localPath ?? libraryPdfPath(row.itemId),
    sizeBytes: Number(row.sizeBytes) || 0,
    contentVersion: Number(row.contentVersion) || 0,
    downloadedAt: row.downloadedAt ?? new Date().toISOString(),
    status: LIBRARY_DOWNLOAD_STATUSES.includes(row.status) ? row.status : "failed",
    lastReadPage: Math.max(1, Number(row.lastReadPage) || 1),
    pageCount: Number.isFinite(pageCount) && pageCount > 0 ? pageCount : null,
    title_en: row.title_en ?? "",
    title_hi: row.title_hi ?? "",
    title_gu: row.title_gu ?? "",
    resumeData: row.resumeData ?? null,
    pdfUrl: row.pdfUrl ?? null,
  };
}

export async function writeDownloadedPdfs(rows: DownloadedPdf[]): Promise<void> {
  await AsyncStorage.setItem(DOWNLOADED_PDF_KEY, JSON.stringify(rows));
}

/** Insert or replace by itemId. */
export async function upsertDownloadedPdf(row: DownloadedPdf): Promise<DownloadedPdf[]> {
  const cur = await readDownloadedPdfs();
  const normalized = normalizeRow(row);
  const idx = cur.findIndex((r) => r.itemId === normalized.itemId);
  if (idx >= 0) cur[idx] = normalized;
  else cur.push(normalized);
  await writeDownloadedPdfs(cur);
  return cur;
}

export async function getDownloadedPdf(itemId: string): Promise<DownloadedPdf | null> {
  const cur = await readDownloadedPdfs();
  return cur.find((r) => r.itemId === itemId) ?? null;
}

/**
 * Record reading position. A no-op when the PDF is not downloaded — reading
 * position is a property of a local file, not of an item.
 */
export async function setLastReadPage(itemId: string, page: number): Promise<void> {
  const cur = await readDownloadedPdfs();
  const idx = cur.findIndex((r) => r.itemId === itemId);
  if (idx < 0) return;
  cur[idx] = { ...cur[idx]!, lastReadPage: Math.max(1, Math.floor(page) || 1) };
  await writeDownloadedPdfs(cur);
}

export async function removeDownloadedPdf(itemId: string): Promise<DownloadedPdf[]> {
  const next = (await readDownloadedPdfs()).filter((r) => r.itemId !== itemId);
  await writeDownloadedPdfs(next);
  return next;
}

export async function clearDownloadedPdfs(): Promise<void> {
  await AsyncStorage.removeItem(DOWNLOADED_PDF_KEY);
}

export function sumDownloadedPdfBytes(rows: DownloadedPdf[]): number {
  return rows
    .filter((r) => r.status === "complete")
    .reduce((acc, r) => acc + (r.sizeBytes || 0), 0);
}

/** Delete local file (if any) and remove the AsyncStorage row. */
export async function deleteDownloadedPdfWithFile(itemId: string): Promise<DownloadedPdf[]> {
  const row = await getDownloadedPdf(itemId);
  const path = row?.localPath || libraryPdfPath(itemId);
  try {
    if (Platform.OS !== "web") {
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists) await FileSystem.deleteAsync(path, { idempotent: true });
    }
  } catch {
    /* ignore missing file */
  }
  return removeDownloadedPdf(itemId);
}

export async function clearAllDownloadedPdfsWithFiles(): Promise<void> {
  const rows = await readDownloadedPdfs();
  for (const row of rows) {
    try {
      await FileSystem.deleteAsync(row.localPath || libraryPdfPath(row.itemId), {
        idempotent: true,
      });
    } catch {
      /* ignore */
    }
  }
  await clearDownloadedPdfs();
}

/** True when a complete download matches the item's content_version and file exists. */
export async function isPdfDownloadCurrent(
  itemId: string,
  contentVersion: number,
): Promise<boolean> {
  const row = await getDownloadedPdf(itemId);
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
