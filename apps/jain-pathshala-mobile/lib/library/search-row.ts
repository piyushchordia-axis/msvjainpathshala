/**
 * Pure FTS row → SearchHit mapping (no SQLite, no react-native).
 *
 * Split out of search-index.ts so the snippet rules can be unit-tested: that
 * module reaches expo-sqlite, which drags react-native's Flow syntax into the
 * vitest bundler and fails to parse.
 */
import { tarjLabel } from "@/lib/library/helpers";
import {
  SNIPPET_START,
  type SearchHit,
  type SearchHitKind,
} from "@/lib/library/search-query";

/** Anything unrecognised falls back to "item" — an index written by an older
 *  build must not produce a hit that navigates nowhere. */
const KNOWN_HIT_KINDS = new Set<string>([
  "item",
  "panchang",
  "granth_entry",
  "granth_library",
]);

/** One row as the FTS query returns it, snippets included. */
export type FtsMatchRow = {
  item_id: string;
  section_id: string;
  subsection_id: string;
  result_kind: string;
  title: string;
  section_title: string;
  title_snip: string;
  body_snip: string;
  body: string;
  /** Raw values, for rendering the caption when the match had no highlight. */
  tarj_en: string;
  tarj_hi: string;
  /** Per-column snippets — the only way to tell a tarj hit from a title hit. */
  tarj_en_snip: string;
  tarj_hi_snip: string;
  roman_tarj_snip: string;
};

function hasMark(s: string | null | undefined): boolean {
  return !!s && s.includes(SNIPPET_START);
}

/**
 * §17.5 — a query that matched only the Tarj shows the Tarj line, so the reader
 * can see why this result came back. Without it a tarj-only hit renders with a
 * body snippet mentioning nothing they typed, which reads as a wrong result
 * rather than a right one.
 *
 * Body and title marks still win: those are the stronger match, and the Tarj
 * would only repeat what the row already shows under the title.
 */
export function pickSnippet(args: {
  titleSnip: string;
  bodySnip: string;
  tarjSnip: string;
  tarjPlain: string;
  localeHi: boolean;
}): string {
  const { titleSnip, bodySnip, tarjSnip, tarjPlain, localeHi } = args;
  if (hasMark(bodySnip)) return bodySnip;
  if (hasMark(titleSnip)) return titleSnip;
  const tarj = tarjSnip || tarjPlain;
  if (tarj) return `${tarjLabel(localeHi)}  ${tarj}`;
  return bodySnip.trim() || titleSnip;
}

export function hitFromMatchRow(r: FtsMatchRow, localeHi: boolean): SearchHit {
  const hasText = (r.body ?? "").trim().length > 0;
  const bodyHasMark = hasMark(r.body_snip);

  // Prefer the highlighted copy in the reader's language, fall back to the
  // other one — a Hindi reader searching a stavan whose Tarj was only entered
  // in English still needs to see which line matched.
  const tarjSnips = localeHi
    ? [r.tarj_hi_snip, r.tarj_en_snip]
    : [r.tarj_en_snip, r.tarj_hi_snip];
  const tarjSnip = tarjSnips.find(hasMark) ?? "";
  // A romanized-only hit ("meri bhavna" against a Devanagari Tarj) has no
  // highlight to show, so fall back to the plain line.
  const tarjMatched = !!tarjSnip || hasMark(r.roman_tarj_snip);
  const tarjPlain = tarjMatched
    ? localeHi
      ? r.tarj_hi || r.tarj_en || ""
      : r.tarj_en || r.tarj_hi || ""
    : "";

  return {
    itemId: r.item_id,
    sectionId: r.section_id,
    subsectionId: r.subsection_id,
    resultKind: KNOWN_HIT_KINDS.has(r.result_kind)
      ? (r.result_kind as SearchHitKind)
      : "item",
    title: r.title,
    sectionTitle: r.section_title,
    snippet: pickSnippet({
      titleSnip: r.title_snip ?? "",
      bodySnip: r.body_snip ?? "",
      tarjSnip,
      tarjPlain,
      localeHi,
    }),
    isTextMatch: bodyHasMark || hasText,
  };
}
