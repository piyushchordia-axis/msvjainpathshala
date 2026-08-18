/**
 * v3 §17.11.3–17.11.4 — the Offline Granth directory.
 *
 * A directory of physical libraries, not content. Shipped as ONE payload
 * (libraries + entries + the join) because §17.11.4 requires it be fully
 * browsable offline: three separate fetches would leave a reader holding
 * libraries with no catalogue the first time one of them failed on a train.
 *
 * Published rows only, in both directions. The city filter on the client is
 * derived from what this returns, so filtering here is what guarantees the
 * filter can never offer an empty city.
 */
import {
  db,
  cities,
  granth_availability,
  granth_entries,
  granth_libraries,
} from "@workspace/db";
import type {
  GranthAvailabilityDto,
  GranthDirectoryDto,
  GranthEntryDto,
  GranthLibraryDto,
} from "@workspace/api-zod";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

/** Postgres hands `numeric` back as a string; the clients want a coordinate. */
function toCoord(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function buildGranthDirectory(): Promise<GranthDirectoryDto> {
  const libraryRows = await db
    .select({ library: granth_libraries, city_name: cities.name })
    .from(granth_libraries)
    .innerJoin(cities, eq(cities.id, granth_libraries.city_id))
    .where(
      and(isNull(granth_libraries.deleted_at), eq(granth_libraries.is_published, true)),
    )
    .orderBy(asc(granth_libraries.order), asc(granth_libraries.name_en));

  const libraries: GranthLibraryDto[] = libraryRows.map(({ library, city_name }) => ({
    id: library.id,
    name_en: library.name_en,
    name_hi: library.name_hi,
    address_en: library.address_en,
    address_hi: library.address_hi,
    city_id: library.city_id,
    // Denormalised: grouping and filtering happen offline, where the client has
    // no cities table to join against.
    city_name,
    contact_name: library.contact_name,
    contact_phone: library.contact_phone,
    has_whatsapp: library.has_whatsapp,
    timings_en: library.timings_en,
    timings_hi: library.timings_hi,
    lat: toCoord(library.lat),
    lng: toCoord(library.lng),
    note_en: library.note_en,
    note_hi: library.note_hi,
    order_index: library.order,
    content_version: library.content_version,
  }));

  const entryRows = await db
    .select()
    .from(granth_entries)
    .where(and(isNull(granth_entries.deleted_at), eq(granth_entries.is_published, true)))
    .orderBy(asc(granth_entries.order), asc(granth_entries.title_en));

  const entries: GranthEntryDto[] = entryRows.map((row) => ({
    id: row.id,
    title_en: row.title_en,
    title_hi: row.title_hi,
    author_en: row.author_en,
    author_hi: row.author_hi,
    language: row.language,
    description_en: row.description_en,
    description_hi: row.description_hi,
    linked_item_id: row.linked_item_id,
    order_index: row.order,
    content_version: row.content_version,
  }));

  // Only joins whose BOTH sides survived the published filter above. A row
  // pointing at an unpublished library would render as a place to go that the
  // reader cannot see, and one pointing at an unpublished granth would put a
  // blank line in a library's catalogue.
  const libraryIds = libraries.map((l) => l.id);
  const entryIds = entries.map((e) => e.id);
  const availability: GranthAvailabilityDto[] =
    libraryIds.length === 0 || entryIds.length === 0
      ? []
      : (
          await db
            .select({
              granth_id: granth_availability.granth_id,
              library_id: granth_availability.library_id,
              note: granth_availability.note,
            })
            .from(granth_availability)
            .where(
              and(
                inArray(granth_availability.granth_id, entryIds),
                inArray(granth_availability.library_id, libraryIds),
              ),
            )
        ).map((row) => ({
          granth_id: row.granth_id,
          library_id: row.library_id,
          note: row.note,
        }));

  return { libraries, entries, availability };
}

/** Version maps for the manifest (§17.7) — published rows only. */
export async function buildGranthManifest(): Promise<{
  granth_libraries: Record<string, number>;
  granth_entries: Record<string, number>;
}> {
  const [libs, ents] = await Promise.all([
    db
      .select({ id: granth_libraries.id, content_version: granth_libraries.content_version })
      .from(granth_libraries)
      .where(
        and(isNull(granth_libraries.deleted_at), eq(granth_libraries.is_published, true)),
      ),
    db
      .select({ id: granth_entries.id, content_version: granth_entries.content_version })
      .from(granth_entries)
      .where(and(isNull(granth_entries.deleted_at), eq(granth_entries.is_published, true))),
  ]);

  const granth_libraries_map: Record<string, number> = {};
  for (const row of libs) granth_libraries_map[row.id] = row.content_version;
  const granth_entries_map: Record<string, number> = {};
  for (const row of ents) granth_entries_map[row.id] = row.content_version;

  return { granth_libraries: granth_libraries_map, granth_entries: granth_entries_map };
}
