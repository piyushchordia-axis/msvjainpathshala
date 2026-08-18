/**
 * SPEC §17.5 / §17.11.4 — the on-device search index, run against a REAL FTS5
 * engine.
 *
 * Node's bundled SQLite has FTS5, so this drives the production DDL, INSERT and
 * MATCH statements straight out of `search-schema.ts` — not a copy. The claims
 * being checked ("a tarj-only query finds the item", "a Roman query finds a
 * Devanagari granth") depend on the tokenizer, the column list and the
 * romanisation all agreeing, which no mock can establish.
 *
 * `search-db.ts` itself reaches expo-sqlite and cannot be imported here; the
 * statements it executes can, which is the point of the split.
 */
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import type {
  GranthDirectoryDto,
  LibraryItemDto,
  LibrarySectionDto,
} from "@workspace/api-zod";
import type { LibraryTreePayload } from "@/lib/library/helpers";
import { collectFtsRows } from "@/lib/library/search-collect";
import {
  buildFtsPrefixQuery,
  buildSkeletonQuery,
} from "@/lib/library/search-query";
import { hitFromMatchRow, type FtsMatchRow } from "@/lib/library/search-row";
import {
  CREATE_SQL,
  INSERT_SQL,
  MATCH_SQL,
  insertValues,
} from "@/lib/library/search-schema";

const SECTION_ID = "11111111-1111-4111-8111-111111111111";
const GRANTH_SECTION_ID = "22222222-2222-4222-8222-222222222222";

function item(over: Partial<LibraryItemDto> & { id: string }): LibraryItemDto {
  return {
    section_id: SECTION_ID,
    subsection_id: null,
    item_code: "ST-01",
    title_en: "Untitled",
    title_hi: null,
    title_gu: null,
    order_index: 0,
    audio_url: null,
    audio_size_bytes: null,
    audio_duration_sec: null,
    youtube_url: null,
    text_content_en: null,
    text_content_hi: null,
    text_content_gu: null,
    tarj_en: null,
    tarj_hi: null,
    pdf_url: null,
    pdf_size_bytes: null,
    pdf_page_count: null,
    external_url: null,
    content_version: 1,
    is_published: true,
    ...over,
  };
}

function section(over: Partial<LibrarySectionDto> & { id: string }): LibrarySectionDto {
  return {
    key: "stavans",
    name_en: "Stavans",
    name_hi: "स्तवन",
    name_gu: null,
    icon_url: null,
    order_index: 0,
    type: "item_list",
    deeplink_target: null,
    requires_login: false,
    is_published: true,
    content_version: 1,
    subsections: [],
    items: [],
    ...over,
  };
}

const tree: LibraryTreePayload = {
  sections: [
    section({
      id: SECTION_ID,
      items: [
        item({
          id: "item-tarj",
          item_code: "ST-01",
          title_en: "Bhaktamar Stotra",
          title_hi: "भक्तामर स्तोत्र",
          text_content_en: "<p>Praise of the first Tirthankar</p>",
          // The only place "Meri Bhavna" appears anywhere in the corpus.
          tarj_en: "Meri Bhavna",
          tarj_hi: "मेरी भावना",
        }),
        item({
          id: "item-plain",
          item_code: "ST-02",
          title_en: "Navkar Mantra",
          text_content_en: "<p>Namo Arihantanam</p>",
        }),
        // Devanagari-ONLY titles. Nothing but the romanisation can reach these,
        // which is the whole of the reported "searching namokar finds nothing".
        item({ id: "item-namokar", item_code: "ST-03", title_en: "", title_hi: "णमोकार महामंत्र" }),
        item({ id: "item-mahavir", item_code: "ST-04", title_en: "", title_hi: "महावीर जयंती" }),
        // English-ONLY, and spelled the long way. Reaching this from a
        // Devanagari query is the "and vice versa" half of §17.5.
        item({ id: "item-english", item_code: "ST-05", title_en: "Mahaveer Jayanti" }),
      ],
    }),
    section({ id: GRANTH_SECTION_ID, key: "granth", name_en: "Granth", type: "granth" }),
  ],
};

const directory: GranthDirectoryDto = {
  libraries: [
    {
      id: "lib-1",
      // Devanagari-only name, to prove the library romanisation works too.
      name_en: "",
      name_hi: "संघवी ग्रंथ भंडार",
      address_en: "Main road",
      address_hi: null,
      city_id: "city-1",
      city_name: "Indore",
      contact_name: null,
      contact_phone: null,
      has_whatsapp: false,
      timings_en: null,
      timings_hi: null,
      lat: null,
      lng: null,
      note_en: null,
      note_hi: null,
      order_index: 0,
      content_version: 1,
    },
  ],
  entries: [
    {
      id: "entry-1",
      // Devanagari-ONLY title: a Roman query can only reach it through the
      // romanisation column.
      title_en: "",
      title_hi: "कल्पसूत्र",
      author_en: null,
      author_hi: "भद्रबाहु",
      language: "Prakrit",
      description_en: null,
      description_hi: null,
      linked_item_id: null,
      order_index: 0,
      content_version: 1,
    },
  ],
  availability: [],
};

let db: DatabaseSync;

function search(raw: string, localeHi = false) {
  const fts = buildFtsPrefixQuery(raw);
  if (!fts) return [];
  const rows = db
    .prepare(MATCH_SQL)
    .all(localeHi ? 1 : 0, fts, 50) as unknown as FtsMatchRow[];
  return rows.map((r) => hitFromMatchRow(r, localeHi));
}

beforeAll(() => {
  db = new DatabaseSync(":memory:");
  db.exec(CREATE_SQL);
  const insert = db.prepare(INSERT_SQL);
  // The production collector, so what is indexed here is what ships.
  for (const row of collectFtsRows(tree, directory)) {
    insert.run(...insertValues(row));
  }
});

describe("real FTS5 index", () => {
  it("indexes items, the panchang shell aside, plus granth entries and libraries", () => {
    const count = db.prepare("SELECT COUNT(*) AS c FROM library_fts").get() as {
      c: number;
    };
    // 5 items + 1 granth entry + 1 granth library.
    expect(count.c).toBe(7);
  });

  it("finds an item by a value that appears ONLY in its tarj", () => {
    // "bhavna" is in no title, no body, no item_code — if the tarj columns were
    // not indexed this returns nothing, which is exactly the regression §17.5
    // exists to prevent.
    const hits = search("bhavna");
    expect(hits.map((h) => h.itemId)).toEqual(["item-tarj"]);
    expect(hits[0]!.snippet).toBe("Tarj  Meri «Bhavna»");
  });

  it("finds the same item from a Devanagari tarj query", () => {
    const hits = search("भावना", true);
    expect(hits.map((h) => h.itemId)).toEqual(["item-tarj"]);
  });

  it("finds a Devanagari granth title from a Roman-script query", () => {
    // The entry's title_hi is कल्पसूत्र and its title_en is empty, so the only
    // route from "kalp" to this row is the romanisation column.
    const hits = search("kalp");
    expect(hits.map((h) => h.itemId)).toEqual(["entry-1"]);
    expect(hits[0]!.resultKind).toBe("granth_entry");
    // Carries the granth section id, so the hit can open the entry detail.
    expect(hits[0]!.sectionId).toBe(GRANTH_SECTION_ID);
  });

  it("finds a Devanagari granth library name from a Roman-script query", () => {
    const hits = search("sangh");
    expect(hits.map((h) => h.itemId)).toEqual(["lib-1"]);
    expect(hits[0]!.resultKind).toBe("granth_library");
    expect(hits[0]!.sectionTitle).toBe("Indore");
  });

  it("finds a granth by its Devanagari author", () => {
    const hits = search("भद्रबाहु", true);
    expect(hits.map((h) => h.itemId)).toEqual(["entry-1"]);
  });

  it("still matches ordinary titles and body text", () => {
    expect(search("bhaktamar").map((h) => h.itemId)).toEqual(["item-tarj"]);
    expect(search("arihantanam").map((h) => h.itemId)).toEqual(["item-plain"]);
  });

  it("returns nothing for a term in no row", () => {
    expect(search("zzzznotpresent")).toEqual([]);
  });
});

/**
 * The tokenizer, read straight out of the index.
 *
 * unicode61's default categories treat every matra and halant as a separator,
 * because Unicode calls them combining marks rather than letters. The shipped
 * index therefore held single consonants, and everything downstream — prefix
 * semantics, bm25 ranking, snippet boundaries — was operating on debris.
 */
describe("Devanagari tokenization", () => {
  it("keeps whole words rather than splitting on every matra", () => {
    db.exec("DROP TABLE IF EXISTS fts_vocab;");
    db.exec("CREATE VIRTUAL TABLE fts_vocab USING fts5vocab(library_fts, row);");
    const terms = (
      db.prepare("SELECT term FROM fts_vocab").all() as unknown as Array<{ term: string }>
    ).map((r) => r.term);

    expect(terms).toContain("भक्तामर");
    expect(terms).toContain("कल्पसूत्र");
    expect(terms).toContain("णमोकार");
    // The fragments the old tokenizer produced from exactly these words.
    expect(terms).not.toContain("भक");
    expect(terms).not.toContain("तवन");
  });

  it("highlights whole words, leaving no matra orphaned outside the markers", () => {
    // The old tokenizer split भक्तामर into भक plus fragments, so snippet() closed
    // the highlight mid-cluster: «भक»्तामर. The halant and matra then rendered
    // outside the highlight as an orphaned sign on a dotted circle.
    const hits = search("भावना", true);
    expect(hits.length).toBeGreaterThan(0);
    const snippet = hits[0]!.snippet;
    expect(snippet).toContain("«");
    // No combining mark may immediately follow a closing marker.
    expect(/»\p{M}/u.test(snippet)).toBe(false);
    expect(snippet).toContain("«भावना»");
  });

  it("stops a bare matra fragment matching in the middle of a word", () => {
    // "मर" is the tail of भक्तामर. Under the old tokenizer it was a whole term
    // and matched; a word-prefix search that matches mid-word is not one.
    expect(search("मर", true)).toEqual([]);
  });
});

/**
 * §17.5, both directions. A Roman query must reach Devanagari content "and
 * vice versa" — the second half needs the QUERY romanised, not just the index.
 */
describe("script-crossing search", () => {
  it.each([
    ["namokar", "item-namokar"],
    ["mahavir", "item-mahavir"],
    ["mahaveer", "item-mahavir"],
    ["bhaktamar", "item-tarj"],
    ["kalpasutra", "entry-1"],
  ])("finds a Devanagari title from the Roman spelling %s", (query, id) => {
    expect(search(query).map((h) => h.itemId)).toContain(id);
  });

  it("finds an English-only title from a Devanagari query", () => {
    // "Mahaveer Jayanti" has no title_hi at all. The only route from महावीर is
    // romanising the QUERY — the direction that did not exist before, since
    // buildFtsPrefixQuery passed Indic input through untransliterated.
    expect(search("महावीर", true).map((h) => h.itemId)).toContain("item-english");
  });

  it("keeps matching the spelling a title actually uses", () => {
    // Folding the query without keeping the raw token would break this: the
    // fix must not cost anything that already worked.
    expect(search("Navkar").map((h) => h.itemId)).toContain("item-plain");
    expect(search("arihantanam").map((h) => h.itemId)).toEqual(["item-plain"]);
  });

  it("still requires every typed word", () => {
    // Each word becomes an OR group of its spellings, but the groups are ANDed.
    expect(search("mahavir arihantanam")).toEqual([]);
  });
});

/**
 * The fallback tier — for a reader who drops a medial vowel the
 * transliteration keeps.
 */
describe("skeleton fallback", () => {
  function searchTwoTier(raw: string) {
    const first = search(raw);
    if (first.length > 0) return { tier: 1, hits: first };
    const skeleton = buildSkeletonQuery(raw);
    if (!skeleton) return { tier: 0, hits: [] };
    const rows = db
      .prepare(MATCH_SQL)
      .all(0, skeleton, 50) as unknown as FtsMatchRow[];
    return { tier: 2, hits: rows.map((r) => hitFromMatchRow(r, false)) };
  }

  it("finds कल्पसूत्र from kalpsutra, which the real query misses", () => {
    // The index holds "kalpasutr"; this reader dropped the medial a.
    expect(search("kalpsutra")).toEqual([]);
    const out = searchTwoTier("kalpsutra");
    expect(out.tier).toBe(2);
    expect(out.hits.map((h) => h.itemId)).toContain("entry-1");
  });

  it("bridges a medial schwa the two spellings disagree about", () => {
    // नवकार romanises to "navakar"; the English title spells it "Navkar". The
    // inherent vowel is written in one and dropped in the other, and no single
    // transliteration can be right for both — which is why the skeleton tier
    // exists rather than being a nicety.
    expect(search("नवकार", true)).toEqual([]);
    const out = searchTwoTier("नवकार");
    expect(out.tier).toBe(2);
    expect(out.hits.map((h) => h.itemId)).toContain("item-plain");
  });

  it("never runs when the real query already found something", () => {
    expect(searchTwoTier("kalpasutra").tier).toBe(1);
  });

  it("refuses to run for a query too short to narrow anything", () => {
    // "grj" would pull in every title with those consonants in that order.
    expect(buildSkeletonQuery("guruji")).toBeNull();
    expect(buildSkeletonQuery("om")).toBeNull();
  });

  it("scopes itself to the skeleton column", () => {
    // If it leaked into the other columns a four-consonant prefix would rank
    // against real title matches.
    expect(buildSkeletonQuery("kalpsutra")).toContain("roman_skeleton :");
  });
});
