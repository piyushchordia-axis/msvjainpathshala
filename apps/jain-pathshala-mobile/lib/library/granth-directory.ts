/**
 * v3 §17.11.3–17.11.4 — Offline Granth directory shaping rules.
 *
 * The rules themselves live in `@workspace/api-zod` because the web app renders
 * the same directory from the same payload, and "by library" and "by granth"
 * only agree about what is where if one implementation answers both. This file
 * stays as the import path every mobile screen already uses.
 */
export {
  EMPTY_DIRECTORY,
  GRANTH_MODES,
  cityOptions,
  defaultCityId,
  entriesAtLibrary,
  entryAuthor,
  entryTitle,
  filterToLibraries,
  groupLibrariesByCity,
  isGranthMode,
  librariesHoldingEntry,
  libraryAddress,
  libraryName,
  parseLibraryIds,
  pickText,
  searchEntries,
  searchLibraries,
  sortedEntries,
} from "@workspace/api-zod";

export type {
  CityGroup,
  CityOption,
  EntryAtLibrary,
  GranthAvailabilityDto,
  GranthBrowseMode,
  GranthDirectoryDto,
  GranthEntryDto,
  GranthLibraryDto,
  LibraryHoldingEntry,
} from "@workspace/api-zod";
