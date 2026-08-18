/**
 * v3 §17.11.3-17.11.4 — Offline Granth directory: shaping rules.
 *
 * Pure, dependency-free, and shared by both clients. The mobile app and the
 * web app render the same directory from the same cached payload; grouping,
 * sorting and cross-indexing living in one place is what keeps "by library"
 * and "by granth" agreeing about what is where.
 *
 * Everything here runs offline against a cached payload — there is no
 * server-side ordering to fall back on.
 */
import type {
  GranthAvailabilityDto,
  GranthDirectoryDto,
  GranthEntryDto,
  GranthLibraryDto,
} from "./contracts";

export type {
  GranthAvailabilityDto,
  GranthDirectoryDto,
  GranthEntryDto,
  GranthLibraryDto,
};

export const GRANTH_MODES = ["library", "granth"] as const;
export type GranthBrowseMode = (typeof GRANTH_MODES)[number];

export function isGranthMode(value: unknown): value is GranthBrowseMode {
  return value === "library" || value === "granth";
}

export const EMPTY_DIRECTORY: GranthDirectoryDto = {
  libraries: [],
  entries: [],
  availability: [],
};

/** Locale pick with fallback — the directory is bilingual, the data often isn't. */
export function pickText(
  hi: boolean,
  en: string | null | undefined,
  hiVal: string | null | undefined,
): string {
  const a = (en ?? "").trim();
  const b = (hiVal ?? "").trim();
  return hi ? b || a : a || b;
}

export function libraryName(lib: GranthLibraryDto, hi: boolean): string {
  return pickText(hi, lib.name_en, lib.name_hi);
}

export function libraryAddress(lib: GranthLibraryDto, hi: boolean): string {
  return pickText(hi, lib.address_en, lib.address_hi);
}

export function entryTitle(entry: GranthEntryDto, hi: boolean): string {
  return pickText(hi, entry.title_en, entry.title_hi);
}

export function entryAuthor(entry: GranthEntryDto, hi: boolean): string {
  return pickText(hi, entry.author_en, entry.author_hi);
}

export type CityOption = { id: string; name: string; count: number };

/**
 * Cities to offer in the filter, derived from the libraries actually held.
 *
 * §17.11.4 — never an empty city. Deriving the list from the rows rather than
 * from the cities table is what guarantees that: a city with no published
 * library simply never appears, so the filter cannot lead anywhere blank.
 */
export function cityOptions(libraries: GranthLibraryDto[]): CityOption[] {
  const byId = new Map<string, CityOption>();
  for (const lib of libraries) {
    const found = byId.get(lib.city_id);
    if (found) found.count += 1;
    else byId.set(lib.city_id, { id: lib.city_id, name: lib.city_name, count: 1 });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * §17.11.4 — default to the viewer's city where known. "Known" means both that
 * we have one AND that it holds a library: defaulting a reader in a city with
 * no listed library to an empty screen is worse than showing them everything.
 */
export function defaultCityId(
  libraries: GranthLibraryDto[],
  viewerCityId: string | null | undefined,
): string | null {
  if (!viewerCityId) return null;
  return libraries.some((l) => l.city_id === viewerCityId) ? viewerCityId : null;
}

export type CityGroup = { cityId: string; cityName: string; libraries: GranthLibraryDto[] };

/** Libraries grouped by city, cities alphabetical, libraries in admin order. */
export function groupLibrariesByCity(
  libraries: GranthLibraryDto[],
  hi: boolean,
  cityId?: string | null,
): CityGroup[] {
  const scoped = cityId ? libraries.filter((l) => l.city_id === cityId) : libraries;
  const groups = new Map<string, CityGroup>();
  for (const lib of scoped) {
    let group = groups.get(lib.city_id);
    if (!group) {
      group = { cityId: lib.city_id, cityName: lib.city_name, libraries: [] };
      groups.set(lib.city_id, group);
    }
    group.libraries.push(lib);
  }
  const out = [...groups.values()];
  out.sort((a, b) => a.cityName.localeCompare(b.cityName));
  for (const group of out) {
    group.libraries.sort(
      (a, b) =>
        a.order_index - b.order_index ||
        libraryName(a, hi).localeCompare(libraryName(b, hi)),
    );
  }
  return out;
}

/**
 * §17.11.4 — alphabetical by title in the reader's language, NOT by the admin's
 * order_index. "Browse by granth" is how someone finds a title they already
 * have in mind, and a hand-curated order defeats that.
 */
export function sortedEntries(entries: GranthEntryDto[], hi: boolean): GranthEntryDto[] {
  return [...entries].sort((a, b) => entryTitle(a, hi).localeCompare(entryTitle(b, hi)));
}

/** Substring search across both languages of title and author. */
export function searchEntries(
  entries: GranthEntryDto[],
  query: string,
  hi: boolean,
): GranthEntryDto[] {
  const q = query.trim().toLowerCase();
  const sorted = sortedEntries(entries, hi);
  if (!q) return sorted;
  return sorted.filter((e) =>
    [e.title_en, e.title_hi, e.author_en, e.author_hi, e.language].some((v) =>
      (v ?? "").toLowerCase().includes(q),
    ),
  );
}

export function searchLibraries(
  libraries: GranthLibraryDto[],
  query: string,
): GranthLibraryDto[] {
  const q = query.trim().toLowerCase();
  if (!q) return libraries;
  return libraries.filter((l) =>
    [l.name_en, l.name_hi, l.address_en, l.address_hi, l.city_name].some((v) =>
      (v ?? "").toLowerCase().includes(q),
    ),
  );
}

export type EntryAtLibrary = { entry: GranthEntryDto; note: string | null };
export type LibraryHoldingEntry = { library: GranthLibraryDto; note: string | null };

/** A library's catalogue, alphabetical, carrying each row's availability note. */
export function entriesAtLibrary(
  directory: GranthDirectoryDto,
  libraryId: string,
  hi: boolean,
): EntryAtLibrary[] {
  const byId = new Map(directory.entries.map((e) => [e.id, e]));
  const out: EntryAtLibrary[] = [];
  for (const row of directory.availability) {
    if (row.library_id !== libraryId) continue;
    const entry = byId.get(row.granth_id);
    if (!entry) continue;
    out.push({ entry, note: row.note });
  }
  out.sort((a, b) => entryTitle(a.entry, hi).localeCompare(entryTitle(b.entry, hi)));
  return out;
}

/** Where one granth can be borrowed, with the per-row note ("reference only"). */
export function librariesHoldingEntry(
  directory: GranthDirectoryDto,
  granthId: string,
  hi: boolean,
): LibraryHoldingEntry[] {
  const byId = new Map(directory.libraries.map((l) => [l.id, l]));
  const out: LibraryHoldingEntry[] = [];
  for (const row of directory.availability) {
    if (row.granth_id !== granthId) continue;
    const library = byId.get(row.library_id);
    if (!library) continue;
    out.push({ library, note: row.note });
  }
  out.sort(
    (a, b) =>
      a.library.city_name.localeCompare(b.library.city_name) ||
      libraryName(a.library, hi).localeCompare(libraryName(b.library, hi)),
  );
  return out;
}

/** Restrict the directory to a set of library ids (the §17.11.4 cross-link). */
export function filterToLibraries(
  libraries: GranthLibraryDto[],
  libraryIds: string[] | null,
): GranthLibraryDto[] {
  if (!libraryIds || libraryIds.length === 0) return libraries;
  const wanted = new Set(libraryIds);
  return libraries.filter((l) => wanted.has(l.id));
}

/** Parse the comma-separated ids the cross-link puts in the URL. */
export function parseLibraryIds(raw: string | string[] | undefined): string[] | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const ids = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : null;
}
