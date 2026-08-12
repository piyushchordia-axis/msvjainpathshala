/**
 * Pure FTS row collection from a library tree (no SQLite).
 */
import type { LibraryItemDto, LibrarySectionDto } from "@workspace/api-zod";
import {
  pickLocalized,
  stripHtml,
  type LibraryTreePayload,
} from "@/lib/library/helpers";
import { buildRomanTitle } from "@/lib/library/romanize";

const BODY_ROMAN_CAP = 2000;

export type FtsRow = {
  item_id: string;
  section_id: string;
  subsection_id: string;
  result_kind: string;
  title: string;
  title_en: string;
  title_hi: string;
  title_gu: string;
  section_en: string;
  section_hi: string;
  section_gu: string;
  subsection_en: string;
  subsection_hi: string;
  subsection_gu: string;
  item_code: string;
  body: string;
  roman_title: string;
};

function itemBodyPlain(item: LibraryItemDto): string {
  const parts = [
    item.text_content_en,
    item.text_content_hi,
    item.text_content_gu,
  ]
    .filter(Boolean)
    .map((html) => stripHtml(String(html)));
  return parts.join("\n").slice(0, BODY_ROMAN_CAP);
}

function displayTitle(item: LibraryItemDto): string {
  return pickLocalized(false, item.title_en, item.title_hi, item.title_gu);
}

function rowForItem(
  section: LibrarySectionDto,
  item: LibraryItemDto,
  sub?: { id: string; name_en: string; name_hi: string | null; name_gu: string | null },
): FtsRow {
  const body = itemBodyPlain(item);
  const roman = buildRomanTitle(
    [
      item.title_en,
      item.title_hi,
      item.title_gu,
      section.name_en,
      section.name_hi,
      section.name_gu,
      sub?.name_en,
      sub?.name_hi,
      sub?.name_gu,
      item.item_code,
      body,
    ],
    BODY_ROMAN_CAP,
  );
  return {
    item_id: item.id,
    section_id: section.id,
    subsection_id: sub?.id ?? item.subsection_id ?? "",
    result_kind: "item",
    title: displayTitle(item),
    title_en: item.title_en ?? "",
    title_hi: item.title_hi ?? "",
    title_gu: item.title_gu ?? "",
    section_en: section.name_en ?? "",
    section_hi: section.name_hi ?? "",
    section_gu: section.name_gu ?? "",
    subsection_en: sub?.name_en ?? "",
    subsection_hi: sub?.name_hi ?? "",
    subsection_gu: sub?.name_gu ?? "",
    item_code: item.item_code ?? "",
    body,
    roman_title: roman,
  };
}

function rowForPanchang(section: LibrarySectionDto): FtsRow {
  const title = pickLocalized(false, section.name_en, section.name_hi, section.name_gu);
  const roman = buildRomanTitle([
    section.name_en,
    section.name_hi,
    section.name_gu,
    title,
  ]);
  return {
    item_id: "",
    section_id: section.id,
    subsection_id: "",
    result_kind: "panchang",
    title,
    title_en: section.name_en ?? "",
    title_hi: section.name_hi ?? "",
    title_gu: section.name_gu ?? "",
    section_en: section.name_en ?? "",
    section_hi: section.name_hi ?? "",
    section_gu: section.name_gu ?? "",
    subsection_en: "",
    subsection_hi: "",
    subsection_gu: "",
    item_code: "",
    body: "",
    roman_title: roman,
  };
}

/** Walk a library tree into FTS rows (pure — no DB). */
export function collectFtsRows(tree: LibraryTreePayload): FtsRow[] {
  const rows: FtsRow[] = [];
  for (const section of tree.sections ?? []) {
    if (section.type === "panchang") {
      rows.push(rowForPanchang(section));
      continue;
    }
    if (section.type !== "item_list") continue;
    for (const sub of section.subsections ?? []) {
      for (const item of sub.items ?? []) {
        rows.push(rowForItem(section, item, sub));
      }
    }
    for (const item of section.items ?? []) {
      rows.push(rowForItem(section, item));
    }
  }
  return rows;
}
