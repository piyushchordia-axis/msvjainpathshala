/**
 * Build / query the offline library FTS index.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { LibraryTreePayload } from "@/lib/library/helpers";
import { collectFtsRows } from "@/lib/library/search-collect";
import { getSearchDb, type SearchDb } from "@/lib/library/search-db";
import {
  buildFtsPrefixQuery,
  type SearchHit,
} from "@/lib/library/search-query";

export { collectFtsRows } from "@/lib/library/search-collect";

export async function rebuildLibrarySearchIndex(
  tree: LibraryTreePayload,
  db: SearchDb = getSearchDb(),
): Promise<void> {
  await db.ensureSchema();
  const rows = collectFtsRows(tree);
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
  db: SearchDb = getSearchDb(),
): Promise<void> {
  if (!tree?.sections?.length) return;
  if (!(await isLibrarySearchIndexEmpty(db))) return;
  await rebuildLibrarySearchIndex(tree, db);
}

function pickSnippet(titleSnip: string, bodySnip: string): string {
  const bodyHasMark = bodySnip.includes("«");
  if (bodyHasMark) return bodySnip;
  if (titleSnip.includes("«")) return titleSnip;
  return bodySnip.trim() || titleSnip;
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
  return rows.map((r) => {
    const hasText = (r.body ?? "").trim().length > 0;
    const bodyHasMark = (r.body_snip ?? "").includes("«");
    return {
      itemId: r.item_id,
      sectionId: r.section_id,
      subsectionId: r.subsection_id,
      resultKind: r.result_kind === "panchang" ? "panchang" : "item",
      title: r.title,
      sectionTitle: r.section_title,
      snippet: pickSnippet(r.title_snip ?? "", r.body_snip ?? ""),
      isTextMatch: bodyHasMark || hasText,
    } satisfies SearchHit;
  });
}
