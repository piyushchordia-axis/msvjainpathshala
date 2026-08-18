/**
 * Build / query the offline library FTS index.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { GranthDirectoryDto } from "@workspace/api-zod";
import type { LibraryTreePayload } from "@/lib/library/helpers";
import { collectFtsRows } from "@/lib/library/search-collect";
import { getSearchDb, type SearchDb } from "@/lib/library/search-db";
import { hitFromMatchRow } from "@/lib/library/search-row";
import {
  buildFtsPrefixQuery,
  type SearchHit,
} from "@/lib/library/search-query";

export { collectFtsRows } from "@/lib/library/search-collect";

export async function rebuildLibrarySearchIndex(
  tree: LibraryTreePayload,
  directory?: GranthDirectoryDto | null,
  db: SearchDb = getSearchDb(),
): Promise<void> {
  await db.ensureSchema();
  const rows = collectFtsRows(tree, directory);
  await db.clearAll();
  await db.insertRows(rows);
}

export async function isLibrarySearchIndexEmpty(
  db: SearchDb = getSearchDb(),
): Promise<boolean> {
  await db.ensureSchema();
  return (await db.countRows()) === 0;
}

/**
 * Prefer member tree when present (logged-in cache), else public —
 * so guests search open content and members search the richer tree.
 */
export function preferredLibraryTree(
  qc: QueryClient,
): LibraryTreePayload | undefined {
  return (
    qc.getQueryData<LibraryTreePayload>(["library", "member"]) ??
    qc.getQueryData<LibraryTreePayload>(["library", "public"])
  );
}

export async function ensureLibrarySearchIndex(
  tree: LibraryTreePayload | undefined,
  directory?: GranthDirectoryDto | null,
  db: SearchDb = getSearchDb(),
): Promise<void> {
  if (!tree?.sections?.length) return;
  if (!(await isLibrarySearchIndexEmpty(db))) return;
  await rebuildLibrarySearchIndex(tree, directory, db);
}

export async function searchLibrary(
  query: string,
  localeHi: boolean,
  db: SearchDb = getSearchDb(),
): Promise<SearchHit[]> {
  const fts = buildFtsPrefixQuery(query);
  if (!fts) return [];
  await db.ensureSchema();
  let rows;
  try {
    rows = await db.match(fts, localeHi);
  } catch {
    // Malformed FTS query — treat as no hits.
    return [];
  }
  return rows.map((r) => hitFromMatchRow(r, localeHi));
}
