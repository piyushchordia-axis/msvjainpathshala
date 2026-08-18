import { describe, expect, it } from "vitest";
import {
  buildRomanSkeleton,
  buildRomanTitle,
  romanSkeleton,
  romanize,
  romanizeWithSchwa,
  searchFold,
} from "@/lib/library/romanize";
import {
  buildFtsPrefixQuery,
  groupHitsBySection,
  parseSnippetHighlight,
  type SearchHit,
} from "@/lib/library/search-query";
import { collectFtsRows } from "@/lib/library/search-collect";
import type { LibraryTreePayload } from "@/lib/library/helpers";

describe("romanize", () => {
  it("maps basic Devanagari to ASCII, literally", () => {
    // Pinned exactly. The previous assertion allowed namaste|nmste|namste,
    // which is every plausible answer at once — it could not have failed, and
    // so it certified the spelling that made Roman search miss.
    expect(romanize("नमस्ते")).toBe("nmste");
    expect(romanize("पुस्तकालय")).toContain("pust");
  });

  it("writes the inherent vowel in the schwa variant", () => {
    expect(romanizeWithSchwa("नमस्ते")).toBe("namaste");
    expect(romanizeWithSchwa("महावीर")).toBe("mahaaveera");
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

describe("searchFold", () => {
  it("collapses the vowel distinctions nobody types", () => {
    // The index wrote mahaaveera and gurujee; readers type mahavir and guruji.
    expect(searchFold("mahaaveera")).toBe("mahavir");
    expect(searchFold("gurujee")).toBe("guruji");
    expect(searchFold("klpsootr")).toBe("klpsutr");
  });

  it("folds the two spellings of व to one", () => {
    expect(searchFold("shwetambar")).toBe(searchFold("shvetambar"));
  });

  it("meets a typed spelling in the middle", () => {
    // The point of folding both sides: neither spelling is privileged.
    expect(searchFold("Mahaveer")).toBe(searchFold("mahavir"));
  });

  it("keeps a short word's final vowel", () => {
    // Dropping it would leave a single consonant matching most of the shelf.
    expect(searchFold("ka")).toBe("ka");
    expect(searchFold("maha")).toBe("mah");
  });

  it("leaves an already-plain word alone", () => {
    expect(searchFold("stavan")).toBe("stavan");
  });
});

describe("romanSkeleton", () => {
  it("drops every vowel", () => {
    expect(romanSkeleton("navakar")).toBe("nvkr");
    expect(romanSkeleton("navkar")).toBe("nvkr");
  });

  it("folds the nasal, which the anusvara romanises one way and readers type the other", () => {
    expect(romanSkeleton("sanvatsari")).toBe(romanSkeleton("samvatsari"));
  });

  it("discards fragments too short to mean anything", () => {
    expect(romanSkeleton("a e i")).toBe("");
  });

  it("builds a skeleton column from titles", () => {
    expect(buildRomanSkeleton(["कल्पसूत्र"])).toBe("klpstr");
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

  it("keeps the Devanagari token AND adds its romanisations", () => {
    // The raw token still reaches the Devanagari columns; the romanised ones
    // are what let this query reach an English-only title (§17.5 "vice versa").
    const q = buildFtsPrefixQuery("नमस्ते");
    expect(q).toContain("नमस्ते*");
    expect(q).toContain("namaste*");
    expect(q!.startsWith("(") && q!.endsWith(")")).toBe(true);
  });

  it("keeps the raw Latin token alongside the folded one", () => {
    // Folding alone would stop "Mahaveer" finding a title spelled "Mahaveer",
    // because title_en is not romanised.
    // Case is left as typed; FTS5's unicode61 tokenizer folds it either way.
    const q = buildFtsPrefixQuery("Mahaveer");
    expect(q).toContain("Mahaveer*");
    expect(q).toContain("mahavir*");
  });

  it("ANDs the groups, so every typed word is still required", () => {
    const q = buildFtsPrefixQuery("भक्तामर स्तवन")!;
    expect(q.split(") (")).toHaveLength(2);
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
