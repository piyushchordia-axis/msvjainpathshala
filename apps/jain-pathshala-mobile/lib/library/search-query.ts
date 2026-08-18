/**
 * Pure FTS query helpers (no SQLite) — unit-tested in vitest.
 */
import {
  romanSkeleton,
  romanize,
  romanizeWithSchwa,
  searchFold,
} from "@/lib/library/romanize";

/** Highlight markers used in FTS snippet() and UI parsing. */
export const SNIPPET_START = "«";
export const SNIPPET_END = "»";

const MIN_SKELETON_LENGTH = 4;

/** Strip the characters FTS5 reads as syntax, then split into raw tokens. */
function rawTokens(raw: string): string[] {
  const cleaned = raw.replace(/["'`:(){}[\]^~\\]/g, " ").trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\s+/)
    .map((t) =>
      // Strip Latin combining marks only (é → e); leave Indic intact.
      t
        .normalize("NFD")
        .replace(/(?<=[A-Za-z])\p{M}/gu, "")
        .normalize("NFC")
        .replace(/[^0-9A-Za-z\u0900-\u097F\u0A80-\u0AFF*]/g, ""),
    )
    .filter((t) => t.length > 0);
}

function isIndic(token: string): boolean {
  return /[\u0900-\u097F\u0A80-\u0AFF]/.test(token);
}

/**
 * Every spelling of one typed word that should be allowed to match.
 *
 * The raw token stays, because it is the only thing that reaches the columns
 * that are NOT romanised — title_en, body, item_code. Dropping it in favour of
 * the folded form alone would stop "Mahaveer" finding a title spelled
 * "Mahaveer", which is a regression, not a fix.
 *
 * An Indic token also contributes its folded romanisations. That is the second
 * half of §17.5 — "and vice versa" — and it is what lets a Devanagari query
 * reach an English-only title. A Latin token contributes its folded self, which
 * is what reaches roman_title.
 */
export function queryTokenVariants(token: string): string[] {
  const variants = [token];
  if (isIndic(token)) {
    variants.push(searchFold(romanize(token)), searchFold(romanizeWithSchwa(token)));
  } else {
    variants.push(searchFold(token));
  }
  return [...new Set(variants.map((v) => v.replace(/\s+/g, "")))].filter(Boolean);
}

/**
 * Sanitize user input into an FTS5 prefix query.
 * Returns null when nothing searchable remains.
 *
 * Each typed word becomes an OR group of its spellings, and the groups are
 * ANDed — so "bhaktamar stavan" still requires both words, but either word may
 * match in either script.
 */
export function buildFtsPrefixQuery(raw: string): string | null {
  const tokens = rawTokens(raw);
  if (tokens.length === 0) return null;
  const groups = tokens
    .map((token) => {
      const variants = queryTokenVariants(token).map((v) =>
        v.endsWith("*") ? v : `${v}*`,
      );
      if (variants.length === 0) return null;
      return variants.length === 1 ? variants[0]! : `(${variants.join(" OR ")})`;
    })
    .filter((g): g is string => g !== null);
  if (groups.length === 0) return null;
  return groups.join(" ");
}

/**
 * The fallback query, against roman_skeleton only.
 *
 * Deliberately NOT part of buildFtsPrefixQuery: ORing the skeleton into the
 * main query would let a four-consonant prefix outrank exact title matches, and
 * bm25 has no way to know one term is a desperate guess. searchLibrary runs
 * this only after the real query came back empty.
 *
 * Returns null below MIN_SKELETON_LENGTH, where a skeleton stops narrowing
 * anything — "grj" would pull in every title with those consonants in order.
 */
export function buildSkeletonQuery(raw: string): string | null {
  const tokens = rawTokens(raw);
  if (tokens.length === 0) return null;
  const skeletons: string[] = [];
  for (const token of tokens) {
    const roman = isIndic(token) ? romanizeWithSchwa(token) : token;
    const skeleton = romanSkeleton(searchFold(roman)).replace(/[^a-z0-9]/g, "");
    if (skeleton.length < MIN_SKELETON_LENGTH) return null;
    skeletons.push(`${skeleton}*`);
  }
  if (skeletons.length === 0) return null;
  return `roman_skeleton : (${skeletons.join(" AND ")})`;
}

export type HighlightPart = { text: string; highlight: boolean };

/** Split a snippet that uses « » markers into highlight parts. */
export function parseSnippetHighlight(snippet: string): HighlightPart[] {
  if (!snippet) return [];
  const parts: HighlightPart[] = [];
  const re = /«([^»]*)»/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(snippet)) !== null) {
    if (m.index > last) {
      parts.push({ text: snippet.slice(last, m.index), highlight: false });
    }
    parts.push({ text: m[1] ?? "", highlight: true });
    last = m.index + m[0].length;
  }
  if (last < snippet.length) {
    parts.push({ text: snippet.slice(last), highlight: false });
  }
  return parts.filter((p) => p.text.length > 0);
}

/**
 * §17.11.4 — a granth match opens the entry detail, a library match opens
 * the library detail. Distinct kinds because the destinations differ; the
 * search screen must not have to guess from the shape of a row.
 */
export type SearchHitKind = "item" | "panchang" | "granth_entry" | "granth_library";

export type SearchHit = {
  itemId: string;
  sectionId: string;
  subsectionId: string;
  resultKind: SearchHitKind;
  title: string;
  sectionTitle: string;
  snippet: string;
  /** True when the match is primarily from body/text content. */
  isTextMatch: boolean;
};

export type SearchHitGroup = {
  sectionId: string;
  sectionTitle: string;
  hits: SearchHit[];
};

export function groupHitsBySection(hits: SearchHit[]): SearchHitGroup[] {
  const order: string[] = [];
  const map = new Map<string, SearchHitGroup>();
  for (const hit of hits) {
    let g = map.get(hit.sectionId);
    if (!g) {
      g = { sectionId: hit.sectionId, sectionTitle: hit.sectionTitle, hits: [] };
      map.set(hit.sectionId, g);
      order.push(hit.sectionId);
    }
    g.hits.push(hit);
  }
  return order.map((id) => map.get(id)!);
}
