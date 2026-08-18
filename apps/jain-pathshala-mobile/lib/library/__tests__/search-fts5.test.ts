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
import { buildFtsPrefixQuery } from "@/lib/library/search-query";
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
    // 2 items + 1 granth entry + 1 granth library.
    expect(count.c).toBe(4);
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
