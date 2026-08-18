/**
 * Pure FTS query helpers (no SQLite) — unit-tested in vitest.
 */

/** Highlight markers used in FTS snippet() and UI parsing. */
export const SNIPPET_START = "«";
export const SNIPPET_END = "»";

/**
 * Sanitize user input into FTS5 prefix AND query.
 * Returns null when nothing searchable remains.
 * Do not NFD-strip Indic matras — that would corrupt Devanagari/Gujarati tokens.
 */
export function buildFtsPrefixQuery(raw: string): string | null {
  const cleaned = raw.replace(/["'`:(){}[\]^~\\]/g, " ").trim();
  if (!cleaned) return null;
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => {
      // Strip Latin combining marks only (é → e); leave Indic intact.
      const noLatinMarks = t
        .normalize("NFD")
        .replace(/(?<=[A-Za-z])\p{M}/gu, "")
        .normalize("NFC");
      return noLatinMarks.replace(
        /[^0-9A-Za-z\u0900-\u097F\u0A80-\u0AFF*]/g,
        "",
      );
    })
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => (t.endsWith("*") ? t : `${t}*`)).join(" ");
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
