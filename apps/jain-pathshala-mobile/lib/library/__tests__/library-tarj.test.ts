/**
 * SPEC §17.1.3 / §17.5 — the Tarj caption and its place in on-device search.
 *
 * Two things are worth pinning down here: the caption never renders as a bare
 * label (an item with no melody must produce nothing at all), and a query that
 * matched only the Tarj comes back showing the Tarj — otherwise the reader gets
 * a row whose visible text contains nothing they typed, which reads as a wrong
 * result rather than a right one.
 */
import { describe, expect, it } from "vitest";
import type { LibraryItemDto, LibrarySectionDto } from "@workspace/api-zod";
import { tarjLabel, tarjLine, type LibraryTreePayload } from "@/lib/library/helpers";
import { collectFtsRows } from "@/lib/library/search-collect";
// search-index reaches expo-sqlite (and through it react-native's Flow
// syntax, which the vitest bundler cannot parse), so the rules live in a
// pure module and searchLibrary is a one-line map over it.
import { hitFromMatchRow, type FtsMatchRow } from "@/lib/library/search-row";

function item(over: Partial<LibraryItemDto> = {}): LibraryItemDto {
  return {
    id: "item-1",
    section_id: "sec-1",
    subsection_id: null,
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

function tree(items: LibraryItemDto[]): LibraryTreePayload {
  const section: LibrarySectionDto = {
    id: "sec-1",
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
    items,
  };
  return { sections: [section] };
}

describe("tarjLine", () => {
  it("renders nothing when the item has no melody", () => {
    expect(tarjLine(item(), false)).toBe("");
    expect(tarjLine(item(), true)).toBe("");
    // Whitespace-only is the same as absent — otherwise the label appears alone.
    expect(tarjLine(item({ tarj_en: "   " }), false)).toBe("");
  });

  it("prefers the viewer's language and falls back to the other", () => {
    const both = item({ tarj_en: "Meri Bhavna", tarj_hi: "मेरी भावना" });
    expect(tarjLine(both, false)).toBe("Meri Bhavna");
    expect(tarjLine(both, true)).toBe("मेरी भावना");

    // A Guruji who only filled the English field still reaches Hindi readers.
    const enOnly = item({ tarj_en: "Meri Bhavna" });
    expect(tarjLine(enOnly, true)).toBe("Meri Bhavna");
    const hiOnly = item({ tarj_hi: "मेरी भावना" });
    expect(tarjLine(hiOnly, false)).toBe("मेरी भावना");
  });

  it("keeps the label untranslated, in Devanagari for Hindi", () => {
    expect(tarjLabel(false)).toBe("Tarj");
    expect(tarjLabel(true)).toBe("तर्ज़");
  });
});

describe("collectFtsRows — Tarj indexing", () => {
  it("indexes both languages and a romanization", () => {
    const rows = collectFtsRows(
      tree([item({ tarj_en: "Meri Bhavna", tarj_hi: "मेरी भावना" })]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tarj_en).toBe("Meri Bhavna");
    expect(rows[0]!.tarj_hi).toBe("मेरी भावना");
    // The romanization is what lets a reader type "meri bhavna" in Latin and
    // still hit a Tarj that was only entered in Devanagari.
    expect(rows[0]!.roman_tarj).toContain("meri");
    expect(rows[0]!.roman_tarj.length).toBeGreaterThan("Meri Bhavna".length);
  });

  it("leaves the tarj columns empty rather than null for an item without one", () => {
    const rows = collectFtsRows(tree([item()]));
    expect(rows[0]!.tarj_en).toBe("");
    expect(rows[0]!.tarj_hi).toBe("");
    expect(rows[0]!.roman_tarj).toBe("");
  });
});

/** A canned FTS row — everything unset is what a non-matching column returns. */
function matchRow(over: Partial<FtsMatchRow> = {}): FtsMatchRow {
  return {
    item_id: "item-1",
    section_id: "sec-1",
    subsection_id: "",
    result_kind: "item",
    title: "Bhaktamar",
    section_title: "Stavans",
    title_snip: "Bhaktamar",
    body_snip: "Praise",
    body: "Praise",
    tarj_en: "",
    tarj_hi: "",
    tarj_en_snip: "",
    tarj_hi_snip: "",
    roman_tarj_snip: "",
    ...over,
  };
}

describe("hitFromMatchRow — Tarj snippets", () => {
  it("shows the Tarj, labelled, when only the Tarj matched", () => {
    const hit = hitFromMatchRow(
      matchRow({ tarj_en: "Meri Bhavna", tarj_en_snip: "Meri «Bhavna»" }),
      false,
    );
    expect(hit.snippet).toBe("Tarj  Meri «Bhavna»");
  });

  it("labels the Tarj in Devanagari for a Hindi reader", () => {
    const hit = hitFromMatchRow(
      matchRow({ tarj_hi: "मेरी भावना", tarj_hi_snip: "मेरी «भावना»" }),
      true,
    );
    expect(hit.snippet).toBe("तर्ज़  मेरी «भावना»");
  });

  it("falls back to the other language when the reader's is not filled in", () => {
    const hit = hitFromMatchRow(
      matchRow({ tarj_en: "Meri Bhavna", tarj_en_snip: "Meri «Bhavna»" }),
      true,
    );
    expect(hit.snippet).toBe("तर्ज़  Meri «Bhavna»");
  });

  it("shows the plain Tarj line when only the romanization matched", () => {
    // "meri" typed in Latin against a Devanagari-only Tarj: the hit is real but
    // the roman column is not what we display, so show the line as it stands.
    const hit = hitFromMatchRow(
      matchRow({ tarj_hi: "मेरी भावना", roman_tarj_snip: "«meri» bhaavnaa" }),
      true,
    );
    expect(hit.snippet).toBe("तर्ज़  मेरी भावना");
  });

  it("lets a body match win — the Tarj would only repeat the row above", () => {
    const hit = hitFromMatchRow(
      matchRow({
        body_snip: "«Praise»",
        tarj_en: "Meri Bhavna",
        tarj_en_snip: "Meri «Bhavna»",
      }),
      false,
    );
    expect(hit.snippet).toBe("«Praise»");
  });

  it("lets a title match win over the Tarj", () => {
    const hit = hitFromMatchRow(
      matchRow({
        title_snip: "«Bhaktamar»",
        tarj_en: "Meri Bhavna",
        tarj_en_snip: "Meri «Bhavna»",
      }),
      false,
    );
    expect(hit.snippet).toBe("«Bhaktamar»");
  });

  it("never emits a bare label when the match came from elsewhere", () => {
    // A section-name or item_code hit on an item that happens to carry a Tarj:
    // no tarj snippet, so the old body/title fallback stands untouched.
    const hit = hitFromMatchRow(matchRow({ tarj_en: "Meri Bhavna" }), false);
    expect(hit.snippet).toBe("Praise");
    expect(hit.snippet).not.toContain("Tarj");
  });

  it("leaves the pre-Tarj behaviour alone for rows with no melody at all", () => {
    expect(hitFromMatchRow(matchRow({ body_snip: "«Praise»" }), false).snippet).toBe(
      "«Praise»",
    );
    expect(hitFromMatchRow(matchRow({ body_snip: "", body: "" }), false).snippet).toBe(
      "Bhaktamar",
    );
  });
});
