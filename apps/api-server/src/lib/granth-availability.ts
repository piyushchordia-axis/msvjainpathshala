/**
 * v3 §17.11.4 — the reverse cross-link.
 *
 * An online granth is an ordinary library item. Some of those items are also
 * catalogued in the physical directory, via `granth_entries.linked_item_id`.
 * This resolves the direction the directory does not: given the items a reader
 * is looking at, which published libraries hold them.
 *
 * Answered for a whole section in one query rather than per item — a granth
 * section can hold a hundred entries, and a per-card request would mean a
 * hundred round trips on a screen that must open offline-first.
 */
import { db, granth_availability, granth_entries, granth_libraries } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

export type ItemGranthAvailability = {
  library_count: number;
  /** Ids to filter the Offline Granth directory to — never the whole catalogue. */
  library_ids: string[];
};

export type GranthAvailabilityMap = Record<string, ItemGranthAvailability>;

/**
 * Items with no published entry, or whose entries are held only at unpublished
 * libraries, are simply absent from the map: the client renders no row rather
 * than "Available at 0 libraries", which would read as a promise the directory
 * cannot keep.
 */
export async function granthAvailabilityForItems(
  itemIds: string[],
): Promise<GranthAvailabilityMap> {
  if (itemIds.length === 0) return {};

  const entries = await db
    .select({ id: granth_entries.id, linked_item_id: granth_entries.linked_item_id })
    .from(granth_entries)
    .where(
      and(
        inArray(granth_entries.linked_item_id, itemIds),
        isNull(granth_entries.deleted_at),
        eq(granth_entries.is_published, true),
      ),
    );
  if (entries.length === 0) return {};

  const entryToItem = new Map<string, string>();
  for (const e of entries) {
    if (e.linked_item_id) entryToItem.set(e.id, e.linked_item_id);
  }

  // Joined against granth_libraries so an unpublished or soft-deleted library
  // never inflates the count a reader is about to act on.
  const rows = await db
    .select({
      granth_id: granth_availability.granth_id,
      library_id: granth_availability.library_id,
    })
    .from(granth_availability)
    .innerJoin(granth_libraries, eq(granth_libraries.id, granth_availability.library_id))
    .where(
      and(
        inArray(granth_availability.granth_id, [...entryToItem.keys()]),
        isNull(granth_libraries.deleted_at),
        eq(granth_libraries.is_published, true),
      ),
    );

  const byItem = new Map<string, Set<string>>();
  for (const row of rows) {
    const itemId = entryToItem.get(row.granth_id);
    if (!itemId) continue;
    let set = byItem.get(itemId);
    if (!set) {
      set = new Set<string>();
      byItem.set(itemId, set);
    }
    // A Set, not a count: two entries for the same granth held at one library
    // is one place to go, not two.
    set.add(row.library_id);
  }

  const out: GranthAvailabilityMap = {};
  for (const [itemId, libs] of byItem) {
    out[itemId] = { library_count: libs.size, library_ids: [...libs] };
  }
  return out;
}
