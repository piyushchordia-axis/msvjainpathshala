/**
 * Library media usage + orphan detection against upload_objects + storage.
 */
import { db, library_items, library_sections, upload_objects } from "@workspace/db";
import { and, isNull, like, inArray } from "drizzle-orm";
import { stat } from "node:fs/promises";
import path from "node:path";
import { storage, UPLOADS_DIR } from "./storage";

export type LibraryMediaOrphan = {
  key: string;
  url: string;
  size_bytes: number;
  uploaded_at: string;
};

/** Extract storage key from a through-app `/uploads/<key>` URL. */
export function keyFromLibraryUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = "/uploads/";
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  const raw = url.slice(idx + marker.length).split("?")[0] ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function sizeForKey(key: string): Promise<number> {
  try {
    const info = await stat(path.join(UPLOADS_DIR, key));
    return info.size;
  } catch {
    return 0;
  }
}

export async function collectReferencedLibraryKeys(): Promise<Set<string>> {
  const refs = new Set<string>();
  const items = await db
    .select({
      audio_url: library_items.audio_url,
      draft_audio_url: library_items.draft_audio_url,
    })
    .from(library_items)
    .where(isNull(library_items.deleted_at));
  for (const row of items) {
    const a = keyFromLibraryUrl(row.audio_url);
    const d = keyFromLibraryUrl(row.draft_audio_url);
    if (a?.startsWith("library/")) refs.add(a);
    if (d?.startsWith("library/")) refs.add(d);
  }
  const sections = await db
    .select({
      icon_url: library_sections.icon_url,
      draft_icon_url: library_sections.draft_icon_url,
    })
    .from(library_sections)
    .where(isNull(library_sections.deleted_at));
  for (const row of sections) {
    const a = keyFromLibraryUrl(row.icon_url);
    const d = keyFromLibraryUrl(row.draft_icon_url);
    if (a?.startsWith("library/")) refs.add(a);
    if (d?.startsWith("library/")) refs.add(d);
  }
  return refs;
}

export async function getLibraryMediaUsage(): Promise<{
  total_bytes: number;
  file_count: number;
  orphans: LibraryMediaOrphan[];
}> {
  const rows = await db
    .select({
      key: upload_objects.key,
      created_at: upload_objects.created_at,
    })
    .from(upload_objects)
    .where(like(upload_objects.key, "library/%"));

  const referenced = await collectReferencedLibraryKeys();
  let total_bytes = 0;
  const orphans: LibraryMediaOrphan[] = [];

  for (const row of rows) {
    const size_bytes = await sizeForKey(row.key);
    total_bytes += size_bytes;
    if (!referenced.has(row.key)) {
      orphans.push({
        key: row.key,
        url: storage.url(row.key),
        size_bytes,
        uploaded_at: row.created_at.toISOString(),
      });
    }
  }

  return { total_bytes, file_count: rows.length, orphans };
}

export async function cleanupLibraryOrphans(keys: string[]): Promise<{
  deleted: number;
  failed: Array<{ key: string; error: string }>;
}> {
  const referenced = await collectReferencedLibraryKeys();
  const usage = await getLibraryMediaUsage();
  const orphanKeys = new Set(usage.orphans.map((o) => o.key));
  const targets =
    keys.length > 0
      ? keys.filter((k) => k.startsWith("library/") && orphanKeys.has(k) && !referenced.has(k))
      : [...orphanKeys];

  let deleted = 0;
  const failed: Array<{ key: string; error: string }> = [];

  for (const key of targets) {
    try {
      await storage.remove(key);
      await db.delete(upload_objects).where(and(inArray(upload_objects.key, [key])));
      deleted += 1;
    } catch (e) {
      failed.push({
        key,
        error: e instanceof Error ? e.message : "Cleanup failed",
      });
    }
  }

  return { deleted, failed };
}
