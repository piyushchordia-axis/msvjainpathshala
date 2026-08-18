/**
 * Pure FTS row collection from a library tree (no SQLite).
 */
import type {
  GranthDirectoryDto,
  GranthEntryDto,
  GranthLibraryDto,
  LibraryItemDto,
  LibrarySectionDto,
} from "@workspace/api-zod";
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
  /**
   * §17.5 — the Tarj is indexed in both languages plus its romanization, so
   * "sung to the tune of X" finds the stavan however the reader types X.
   * Kept in its own columns rather than folded into body/roman_title so a
   * tarj-only hit is still distinguishable at read time and can supply the
   * snippet.
   */
  tarj_en: string;
  tarj_hi: string;
  roman_tarj: string;
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
    tarj_en: item.tarj_en ?? "",
    tarj_hi: item.tarj_hi ?? "",
    roman_tarj: buildRomanTitle([item.tarj_en, item.tarj_hi]),
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
    tarj_en: "",
    tarj_hi: "",
    roman_tarj: "",
  };
}

/**
 * §17.11.4 — a granth in the physical directory. Indexed with its author and
 * romanisation so "kalpasutra" typed in Latin finds a Devanagari title.
 *
 * The granth section id rides on the row so the search screen can open the
 * detail without a second lookup — that screen has no directory in hand.
 */
function rowForGranthEntry(sectionId: string, entry: GranthEntryDto): FtsRow {
  const title = pickLocalized(false, entry.title_en, entry.title_hi, null);
  const body = [entry.author_en, entry.author_hi, entry.language]
    .filter(Boolean)
    .join(" · ");
  return {
    item_id: entry.id,
    section_id: sectionId,
    subsection_id: "",
    result_kind: "granth_entry",
    title,
    title_en: entry.title_en ?? "",
    title_hi: entry.title_hi ?? "",
    title_gu: "",
    section_en: "",
    section_hi: "",
    section_gu: "",
    subsection_en: "",
    subsection_hi: "",
    subsection_gu: "",
    item_code: "",
    body,
    // Same transliteration path as roman_title, per §17.5.
    roman_title: buildRomanTitle([
      entry.title_en,
      entry.title_hi,
      entry.author_en,
      entry.author_hi,
    ]),
    tarj_en: "",
    tarj_hi: "",
    roman_tarj: "",
  };
}

/** A physical library. Names only — a reader searches for "Sanghvi", not an address. */
function rowForGranthLibrary(sectionId: string, lib: GranthLibraryDto): FtsRow {
  const title = pickLocalized(false, lib.name_en, lib.name_hi, null);
  return {
    item_id: lib.id,
    section_id: sectionId,
    subsection_id: "",
    result_kind: "granth_library",
    title,
    title_en: lib.name_en ?? "",
    title_hi: lib.name_hi ?? "",
    title_gu: "",
    // The city reads as the section line under the hit, which is exactly
    // what someone scanning a list of libraries needs to tell them apart.
    section_en: lib.city_name ?? "",
    section_hi: lib.city_name ?? "",
    section_gu: "",
    subsection_en: "",
    subsection_hi: "",
    subsection_gu: "",
    item_code: "",
    body: "",
    roman_title: buildRomanTitle([lib.name_en, lib.name_hi, lib.city_name]),
    tarj_en: "",
    tarj_hi: "",
    roman_tarj: "",
  };
}

/**
 * Walk a library tree into FTS rows (pure — no DB).
 *
 * `directory` is optional because most callers have only the tree; when it
 * is present its published rows are indexed against the granth section.
 */
export function collectFtsRows(
  tree: LibraryTreePayload,
  directory?: GranthDirectoryDto | null,
): FtsRow[] {
  const rows: FtsRow[] = [];
  const granthSectionId =
    (tree.sections ?? []).find((s) => s.type === "granth")?.id ?? "";
  if (directory && granthSectionId) {
    for (const entry of directory.entries ?? []) {
      rows.push(rowForGranthEntry(granthSectionId, entry));
    }
    for (const lib of directory.libraries ?? []) {
      rows.push(rowForGranthLibrary(granthSectionId, lib));
    }
  }
  for (const section of tree.sections ?? []) {
    if (section.type === "panchang") {
      rows.push(rowForPanchang(section));
      continue;
    }
    // §17.11.2 — a granth section's items are ordinary library items and are
    // indexed exactly like any other. Skipping them here would make the whole
    // Granth shelf invisible to search while looking perfectly normal on screen.
    if (section.type !== "item_list" && section.type !== "granth") continue;
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
