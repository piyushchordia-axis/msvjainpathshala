import { describe, expect, it } from "vitest";
import { buildRomanTitle, romanize } from "@/lib/library/romanize";
import {
  buildFtsPrefixQuery,
  groupHitsBySection,
  parseSnippetHighlight,
  type SearchHit,
} from "@/lib/library/search-query";
import { collectFtsRows } from "@/lib/library/search-collect";
import type { LibraryTreePayload } from "@/lib/library/helpers";

describe("romanize", () => {
  it("maps basic Devanagari to ASCII", () => {
    expect(romanize("नमस्ते")).toMatch(/namaste|nmste|namste/);
    expect(romanize("पुस्तकालय")).toContain("pust");
  });

  it("maps basic Gujarati to ASCII", () => {
    const out = romanize("નમસ્તે");
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/[a-z]/);
  });

  it("lowercases Latin and collapses spaces", () => {
    expect(romanize("  Hello   WORLD  ")).toBe("hello world");
  });

  it("buildRomanTitle joins parts", () => {
    const r = buildRomanTitle(["Hello", "नमस्ते", null, ""]);
    expect(r).toContain("hello");
    expect(r.length).toBeGreaterThan(5);
  });
});

describe("buildFtsPrefixQuery", () => {
  it("returns null for empty / punctuation-only", () => {
    expect(buildFtsPrefixQuery("")).toBeNull();
    expect(buildFtsPrefixQuery("   ")).toBeNull();
    expect(buildFtsPrefixQuery('""')).toBeNull();
  });

  it("builds prefix AND tokens", () => {
    expect(buildFtsPrefixQuery("ram nam")).toBe("ram* nam*");
    expect(buildFtsPrefixQuery("already*")).toBe("already*");
  });

  it("keeps Devanagari tokens", () => {
    expect(buildFtsPrefixQuery("नमस्ते")).toBe("नमस्ते*");
  });
});

describe("parseSnippetHighlight", () => {
  it("splits « » markers", () => {
    expect(parseSnippetHighlight("hello «world» there")).toEqual([
      { text: "hello ", highlight: false },
      { text: "world", highlight: true },
      { text: " there", highlight: false },
    ]);
  });

  it("handles multiple highlights", () => {
    const parts = parseSnippetHighlight("«a» and «b»");
    expect(parts.filter((p) => p.highlight).map((p) => p.text)).toEqual(["a", "b"]);
  });
});

describe("groupHitsBySection", () => {
  it("preserves first-seen section order", () => {
    const hits: SearchHit[] = [
      {
        itemId: "1",
        sectionId: "s2",
        subsectionId: "",
        resultKind: "item",
        title: "B",
        sectionTitle: "Two",
        snippet: "",
        isTextMatch: false,
      },
      {
        itemId: "2",
        sectionId: "s1",
        subsectionId: "",
        resultKind: "item",
        title: "A",
        sectionTitle: "One",
        snippet: "",
        isTextMatch: true,
      },
      {
        itemId: "3",
        sectionId: "s2",
        subsectionId: "",
        resultKind: "item",
        title: "C",
        sectionTitle: "Two",
        snippet: "",
        isTextMatch: false,
      },
    ];
    const groups = groupHitsBySection(hits);
    expect(groups.map((g) => g.sectionId)).toEqual(["s2", "s1"]);
    expect(groups[0]!.hits).toHaveLength(2);
  });
});

describe("collectFtsRows", () => {
  it("indexes items and a synthetic panchang row", () => {
    const tree: LibraryTreePayload = {
      sections: [
        {
          id: "sec-list",
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
          subsections: [
            {
              id: "sub-1",
              section_id: "sec-list",
              name_en: "Morning",
              name_hi: null,
              name_gu: null,
              order_index: 0,
              content_version: 1,
              is_published: true,
              items: [
                {
                  id: "item-1",
                  section_id: "sec-list",
                  subsection_id: "sub-1",
                  item_code: "ST-01",
                  title_en: "Bhaktamar",
                  title_hi: "भक्तामर",
                  title_gu: null,
                  order_index: 0,
                  audio_url: null,
                  audio_size_bytes: null,
                  audio_duration_sec: null,
                  youtube_url: null,
                  text_content_en: "<p>Praise</p>",
                  text_content_hi: null,
                  text_content_gu: null,
                  tarj_en: "Meri Bhavna",
                  tarj_hi: "मेरी भावना",
                  pdf_url: null,
                  pdf_size_bytes: null,
                  pdf_page_count: null,
                  external_url: null,
                  content_version: 1,
                  is_published: true,
                },
              ],
            },
          ],
          items: [],
        },
        {
          id: "sec-pan",
          key: "panchang",
          name_en: "Panchang",
          name_hi: "पंचांग",
          name_gu: null,
          icon_url: null,
          order_index: 1,
          type: "panchang",
          deeplink_target: null,
          requires_login: false,
          is_published: true,
          content_version: 1,
        },
      ],
    };
    const rows = collectFtsRows(tree);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.result_kind).toBe("item");
    expect(rows[0]!.body).toContain("Praise");
    expect(rows[0]!.roman_title.length).toBeGreaterThan(0);
    expect(rows[1]!.result_kind).toBe("panchang");
    expect(rows[1]!.item_id).toBe("");
  });
});
