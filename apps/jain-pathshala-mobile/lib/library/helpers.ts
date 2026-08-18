import type { LibraryItemDto, LibrarySectionDto } from "@workspace/api-zod";
import type { QueryClient } from "@tanstack/react-query";

export type LibraryTreePayload = { sections: LibrarySectionDto[] };

/** Strip HTML tags for plain-text library readers (no WebView in v1). */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function pickLocalized(
  hi: boolean,
  en: string | null | undefined,
  hiVal: string | null | undefined,
  gu?: string | null,
): string {
  if (hi) return hiVal || en || gu || "";
  return en || hiVal || gu || "";
}

export function itemHasText(item: LibraryItemDto): boolean {
  return !!(item.text_content_en || item.text_content_hi || item.text_content_gu);
}

/**
 * §17.1.3 — the melody caption, in the viewer's language with fallback to the
 * other. Returns "" when both are null so callers render nothing at all: a
 * "Tarj" label with no melody after it is worse than no line.
 */
export function tarjLine(item: LibraryItemDto, hi: boolean): string {
  const en = item.tarj_en?.trim() || "";
  const hiVal = item.tarj_hi?.trim() || "";
  return hi ? hiVal || en : en || hiVal;
}

/** The label itself — a Jain/Indic term, kept untranslated in both locales. */
export function tarjLabel(hi: boolean): string {
  return hi ? "तर्ज़" : "Tarj";
}

export function findSectionInTrees(
  trees: Array<LibraryTreePayload | undefined>,
  sectionId: string,
): LibrarySectionDto | null {
  for (const tree of trees) {
    const found = tree?.sections.find((s) => s.id === sectionId);
    if (found) return found;
  }
  return null;
}

export function findItemInTrees(
  trees: Array<LibraryTreePayload | undefined>,
  itemId: string,
): { section: LibrarySectionDto; item: LibraryItemDto } | null {
  for (const tree of trees) {
    if (!tree) continue;
    for (const section of tree.sections) {
      for (const sub of section.subsections ?? []) {
        const item = (sub.items ?? []).find((i) => i.id === itemId);
        if (item) return { section, item };
      }
      const loose = (section.items ?? []).find((i) => i.id === itemId);
      if (loose) return { section, item: loose };
    }
  }
  return null;
}

/** Flatten published items with their parent section (bookmarks list). */
export function listItemsInTrees(
  trees: Array<LibraryTreePayload | undefined>,
): Array<{ section: LibrarySectionDto; item: LibraryItemDto }> {
  const seen = new Set<string>();
  const out: Array<{ section: LibrarySectionDto; item: LibraryItemDto }> = [];
  for (const tree of trees) {
    if (!tree) continue;
    for (const section of tree.sections) {
      for (const sub of section.subsections ?? []) {
        for (const item of sub.items ?? []) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          out.push({ section, item });
        }
      }
      for (const item of section.items ?? []) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push({ section, item });
      }
    }
  }
  return out;
}

/** Prefer member cache when present, else public. */
export function libraryTreesFromCache(
  qc: QueryClient,
): Array<LibraryTreePayload | undefined> {
  return [
    qc.getQueryData<LibraryTreePayload>(["library", "member"]),
    qc.getQueryData<LibraryTreePayload>(["library", "public"]),
  ];
}
