/**
 * The library FTS schema and its statements — pure, so the real SQL can be run
 * against a real FTS5 engine in tests rather than approximated by a mock.
 *
 * search-db.ts reaches expo-sqlite (and through it react-native's Flow syntax,
 * which the test bundler cannot parse), so a test that re-declared this DDL
 * would be verifying a copy. Everything the engine actually sees lives here.
 */
import type { FtsRow } from "@/lib/library/search-collect";

/**
 * Bump whenever the column list changes.
 *
 * CREATE VIRTUAL TABLE IF NOT EXISTS is a no-op against an existing table, so
 * an app updated in place would keep the old column list and every insert
 * naming a new column would fail with "no such column" — search would go
 * quietly dead on exactly the devices that already had it working.
 *
 * Bumped for a CONTENT change too, not only a column change: the romanisation
 * now writes the inherent vowel as well, and a device holding the old index
 * would keep missing "kalpasutra" until something unrelated forced a rebuild.
 *
 * 4: the tokenizer stopped splitting Devanagari on every matra, roman_title
 * changed to folded spellings, and roman_skeleton appeared. A device on 3 holds
 * an index whose tokens are single consonants, so it must be dropped and
 * rebuilt — there is nothing in it worth keeping.
 */
export const FTS_SCHEMA_VERSION = 4;

export const FTS_TABLE = "library_fts";

/**
 * The single source of both the CREATE statement and the ordinals snippet()
 * needs. snippet() addresses columns by position, so a hand-maintained index
 * table silently repoints every call the moment a column is inserted rather
 * than appended — a break that shows up as slightly-wrong snippets, not an error.
 */
export const FTS_COLUMNS = [
  { name: "item_id", indexed: false },
  { name: "section_id", indexed: false },
  { name: "subsection_id", indexed: false },
  { name: "result_kind", indexed: false },
  { name: "title", indexed: true },
  { name: "title_en", indexed: true },
  { name: "title_hi", indexed: true },
  { name: "title_gu", indexed: true },
  { name: "section_en", indexed: true },
  { name: "section_hi", indexed: true },
  { name: "section_gu", indexed: true },
  { name: "subsection_en", indexed: true },
  { name: "subsection_hi", indexed: true },
  { name: "subsection_gu", indexed: true },
  { name: "item_code", indexed: true },
  { name: "body", indexed: true },
  { name: "roman_title", indexed: true },
  // §17.5 — Tarj in both languages plus its romanization.
  { name: "tarj_en", indexed: true },
  { name: "tarj_hi", indexed: true },
  { name: "roman_tarj", indexed: true },
  // Last-resort consonant skeleton. Titles and tarj only, never the body: a
  // four-letter skeleton prefix over a page of text would match half the shelf.
  //
  // searchLibrary aims the SKELETON QUERY here only after the real query came
  // back empty. The column is still indexed, so an unfiltered MATCH can reach
  // it incidentally — harmless, since a folded query token and a skeleton token
  // rarely coincide, and when they do the row is one the reader wanted anyway.
  { name: "roman_skeleton", indexed: true },
] as const;

export type FtsColumnName = (typeof FTS_COLUMNS)[number]["name"];

export function ftsCol(name: FtsColumnName): number {
  return FTS_COLUMNS.findIndex((c) => c.name === name);
}

/**
 * `categories` is what keeps Devanagari words whole.
 *
 * unicode61 classifies by Unicode category and by default counts only letters
 * and numbers as token characters. Every matra and every halant is Mn or Mc — a
 * COMBINING mark, not a letter — so the default treats them as separators, and
 * 'भक्तामर स्तवन णमोकार' indexes as ["क","णम","त","तवन","भक","मर","र","स"].
 * Prefix search over that is meaningless: "मर*" matches भक्तामर in the middle,
 * a single consonant matches most of the shelf, bm25 ranks fragments, and
 * snippet() cuts between a consonant and its matra, so the highlight renders an
 * orphaned vowel sign on a dotted circle.
 *
 * Adding Mn and Mc to the token categories restores whole words. Co covers the
 * private-use codepoints some Devanagari fonts still ship glyphs for.
 *
 * remove_diacritics 2 stays. It strips Latin diacritics (é → e), and Indic
 * matras are not decomposable diacritics, so they survive it — checked against
 * the engine rather than assumed.
 */
export const CREATE_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE} USING fts5(
  ${FTS_COLUMNS.map((c) => (c.indexed ? c.name : `${c.name} UNINDEXED`)).join(", ")},
  tokenize = 'unicode61 remove_diacritics 2 categories ''L* N* Co Mn Mc'''
);
`;

const COLUMN_NAMES = FTS_COLUMNS.map((c) => c.name);

export const INSERT_SQL = `INSERT INTO ${FTS_TABLE}(${COLUMN_NAMES.join(", ")}) VALUES (${COLUMN_NAMES.map(
  () => "?",
).join(",")})`;

/** Bind values in the exact column order the INSERT declares. */
export function insertValues(r: FtsRow): Array<string> {
  return COLUMN_NAMES.map((name) => (r as unknown as Record<string, string>)[name] ?? "");
}

/**
 * The read query. `localeHi` binds first, then the FTS expression, then the
 * limit — the snippet ordinals come from FTS_COLUMNS, never written by hand.
 */
export const MATCH_SQL = `SELECT
  item_id,
  section_id,
  subsection_id,
  result_kind,
  title,
  CASE WHEN ? THEN
    CASE WHEN length(section_hi) > 0 THEN section_hi ELSE section_en END
  ELSE
    CASE WHEN length(section_en) > 0 THEN section_en ELSE section_hi END
  END AS section_title,
  snippet(${FTS_TABLE}, ${ftsCol("title")}, '«', '»', '…', 12) AS title_snip,
  snippet(${FTS_TABLE}, ${ftsCol("body")}, '«', '»', '…', 12) AS body_snip,
  body,
  tarj_en,
  tarj_hi,
  snippet(${FTS_TABLE}, ${ftsCol("tarj_en")}, '«', '»', '…', 12) AS tarj_en_snip,
  snippet(${FTS_TABLE}, ${ftsCol("tarj_hi")}, '«', '»', '…', 12) AS tarj_hi_snip,
  snippet(${FTS_TABLE}, ${ftsCol("roman_tarj")}, '«', '»', '…', 12) AS roman_tarj_snip
FROM ${FTS_TABLE}
WHERE ${FTS_TABLE} MATCH ?
ORDER BY bm25(${FTS_TABLE})
LIMIT ?`;
