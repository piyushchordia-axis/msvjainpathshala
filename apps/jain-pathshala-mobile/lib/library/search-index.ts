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
  buildSkeletonQuery,
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

/** One MATCH, with a malformed expression treated as no hits rather than a crash. */
async function runMatch(
  db: SearchDb,
  fts: string,
  localeHi: boolean,
): Promise<SearchHit[]> {
  try {
    const rows = await db.match(fts, localeHi);
    return rows.map((r) => hitFromMatchRow(r, localeHi));
  } catch {
    return [];
  }
}

/**
 * Search in two tiers.
 *
 * Tier 1 is the real query: every typed word in every spelling it could have,
 * across both scripts. Tier 2 drops all the vowels and tries again, and exists
 * for one narrow case — a reader who omits a medial vowel the transliteration
 * keeps ("navkar" for नवकार, "kalpsutra" for कल्पसूत्र).
 *
 * Tier 2 runs ONLY when tier 1 found nothing. It is a much weaker signal, and
 * blending the two would let a consonant-skeleton guess outrank an exact title
 * match — bm25 cannot tell that one of the terms was a guess. Zero results is
 * also the only moment the extra query costs nothing anybody notices.
 */
export async function searchLibrary(
  query: string,
  localeHi: boolean,
  db: SearchDb = getSearchDb(),
): Promise<SearchHit[]> {
  const fts = buildFtsPrefixQuery(query);
  if (!fts) return [];
  await db.ensureSchema();

  const hits = await runMatch(db, fts, localeHi);
  if (hits.length > 0) return hits;

  const skeleton = buildSkeletonQuery(query);
  if (!skeleton) return hits;
  return runMatch(db, skeleton, localeHi);
}
