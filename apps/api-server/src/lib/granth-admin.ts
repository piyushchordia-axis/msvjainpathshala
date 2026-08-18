/**
 * v3 §17.11.5 — Granth directory authority and draft/publish.
 *
 * Authority lives HERE, not in a router guard. The three resources need three
 * different rules over the same mount point, and a guard can only express one:
 *
 *   granth_libraries    city_admin+, but a city_admin only inside their own city
 *   granth_entries      state_admin+ (a granth is national; a city does not own it)
 *   granth_availability city_admin+, only where the LIBRARY is in their city
 *
 * sanchalak and shikshak have no granth authority at all — the router's
 * city_admin gate already stops them, and nothing below re-opens the door.
 */
import {
  db,
  granth_availability,
  granth_entries,
  granth_libraries,
  type User,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

import { hasMinRole } from "./roles";
import { userCanAccessCity } from "./scope";

export class GranthForbiddenError extends Error {
  readonly code = "ERR_FORBIDDEN" as const;
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "GranthForbiddenError";
  }
}

export class GranthNotFoundError extends Error {
  readonly code = "ERR_NOT_FOUND" as const;
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = "GranthNotFoundError";
  }
}

/** Entries and the granth section itself are state_admin and above. */
export function canManageGranthEntries(role: string | null | undefined): boolean {
  return hasMinRole(role, "state_admin");
}

export function assertCanManageEntries(user: User): void {
  if (!canManageGranthEntries(user.role)) {
    throw new GranthForbiddenError(
      "Granth entries are managed by state admins — ask yours to add or edit this granth.",
    );
  }
}

/**
 * A library is in scope when BOTH its current city and the city the write
 * would move it to are in scope.
 *
 * Checking only the current city lets a city_admin move a library into their
 * own city and then own it; checking only the target lets them move one out and
 * lose it. The pair is the rule.
 */
export async function assertLibraryCityInScope(
  user: User,
  cityIds: Array<string | null | undefined>,
): Promise<void> {
  for (const cityId of cityIds) {
    if (!cityId) continue;
    if (!(await userCanAccessCity(user, cityId))) {
      throw new GranthForbiddenError("City not in your scope.");
    }
  }
}

/** Load a live library row, or 404. */
export async function loadLibrary(id: string) {
  const [row] = await db
    .select()
    .from(granth_libraries)
    .where(and(eq(granth_libraries.id, id), isNull(granth_libraries.deleted_at)))
    .limit(1);
  if (!row) throw new GranthNotFoundError("That granth library could not be found.");
  return row;
}

export async function loadEntry(id: string) {
  const [row] = await db
    .select()
    .from(granth_entries)
    .where(and(eq(granth_entries.id, id), isNull(granth_entries.deleted_at)))
    .limit(1);
  if (!row) throw new GranthNotFoundError("That granth could not be found.");
  return row;
}

/**
 * Guard a write to an existing library: the row's live city and its draft city
 * must both be reachable, so an in-flight draft move cannot be used to escape.
 */
export async function assertCanWriteLibrary(
  user: User,
  row: { city_id: string; draft_city_id: string },
  nextCityId?: string | null,
): Promise<void> {
  await assertLibraryCityInScope(user, [row.city_id, row.draft_city_id, nextCityId]);
}

/** Availability is governed by the library's city, never the granth's. */
export async function assertCanWriteAvailability(
  user: User,
  libraryId: string,
): Promise<void> {
  const library = await loadLibrary(libraryId);
  await assertCanWriteLibrary(user, library);
}

/* ── draft → published ────────────────────────────────────────────────────── */

/**
 * Publish copies the draft across and increments content_version. The bump is
 * not decoration: the manifest is how a device holding the cached directory
 * learns anything changed, so a publish that skipped it would be invisible.
 */
export async function publishGranthLibrary(id: string) {
  const row = await loadLibrary(id);
  const [updated] = await db
    .update(granth_libraries)
    .set({
      name_en: row.draft_name_en,
      name_hi: row.draft_name_hi,
      address_en: row.draft_address_en,
      address_hi: row.draft_address_hi,
      city_id: row.draft_city_id,
      contact_name: row.draft_contact_name,
      contact_phone: row.draft_contact_phone,
      has_whatsapp: row.draft_has_whatsapp,
      timings_en: row.draft_timings_en,
      timings_hi: row.draft_timings_hi,
      lat: row.draft_lat,
      lng: row.draft_lng,
      note_en: row.draft_note_en,
      note_hi: row.draft_note_hi,
      order: row.draft_order,
      is_published: true,
      content_version: row.content_version + 1,
      updated_at: new Date(),
    })
    .where(eq(granth_libraries.id, id))
    .returning();
  return updated ?? null;
}

export async function unpublishGranthLibrary(id: string) {
  const [updated] = await db
    .update(granth_libraries)
    .set({ is_published: false, updated_at: new Date() })
    .where(and(eq(granth_libraries.id, id), isNull(granth_libraries.deleted_at)))
    .returning();
  return updated ?? null;
}

export async function publishGranthEntry(id: string) {
  const row = await loadEntry(id);
  const [updated] = await db
    .update(granth_entries)
    .set({
      title_en: row.draft_title_en,
      title_hi: row.draft_title_hi,
      author_en: row.draft_author_en,
      author_hi: row.draft_author_hi,
      language: row.draft_language,
      description_en: row.draft_description_en,
      description_hi: row.draft_description_hi,
      linked_item_id: row.draft_linked_item_id,
      order: row.draft_order,
      is_published: true,
      content_version: row.content_version + 1,
      updated_at: new Date(),
    })
    .where(eq(granth_entries.id, id))
    .returning();
  return updated ?? null;
}

export async function unpublishGranthEntry(id: string) {
  const [updated] = await db
    .update(granth_entries)
    .set({ is_published: false, updated_at: new Date() })
    .where(and(eq(granth_entries.id, id), isNull(granth_entries.deleted_at)))
    .returning();
  return updated ?? null;
}

/* ── admin DTOs ───────────────────────────────────────────────────────────── */

/** numeric → number for the client; Postgres returns these as strings. */
function num(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function mapLibraryAdmin(
  row: typeof granth_libraries.$inferSelect,
  cityName?: string | null,
) {
  return {
    id: row.id,
    is_published: row.is_published,
    content_version: row.content_version,
    /** Resolved from the DRAFT city — that is the one the editor is showing. */
    city_name: cityName ?? null,
    draft: {
      name_en: row.draft_name_en,
      name_hi: row.draft_name_hi,
      address_en: row.draft_address_en,
      address_hi: row.draft_address_hi,
      city_id: row.draft_city_id,
      contact_name: row.draft_contact_name,
      contact_phone: row.draft_contact_phone,
      has_whatsapp: row.draft_has_whatsapp,
      timings_en: row.draft_timings_en,
      timings_hi: row.draft_timings_hi,
      lat: num(row.draft_lat),
      lng: num(row.draft_lng),
      note_en: row.draft_note_en,
      note_hi: row.draft_note_hi,
      order_index: row.draft_order,
    },
    published: {
      name_en: row.name_en,
      name_hi: row.name_hi,
      address_en: row.address_en,
      address_hi: row.address_hi,
      city_id: row.city_id,
      contact_name: row.contact_name,
      contact_phone: row.contact_phone,
      has_whatsapp: row.has_whatsapp,
      timings_en: row.timings_en,
      timings_hi: row.timings_hi,
      lat: num(row.lat),
      lng: num(row.lng),
      note_en: row.note_en,
      note_hi: row.note_hi,
      order_index: row.order,
    },
  };
}

export function mapEntryAdmin(row: typeof granth_entries.$inferSelect) {
  return {
    id: row.id,
    is_published: row.is_published,
    content_version: row.content_version,
    draft: {
      title_en: row.draft_title_en,
      title_hi: row.draft_title_hi,
      author_en: row.draft_author_en,
      author_hi: row.draft_author_hi,
      language: row.draft_language,
      description_en: row.draft_description_en,
      description_hi: row.draft_description_hi,
      linked_item_id: row.draft_linked_item_id,
      order_index: row.draft_order,
    },
    published: {
      title_en: row.title_en,
      title_hi: row.title_hi,
      author_en: row.author_en,
      author_hi: row.author_hi,
      language: row.language,
      description_en: row.description_en,
      description_hi: row.description_hi,
      linked_item_id: row.linked_item_id,
      order_index: row.order,
    },
  };
}

/**
 * Availability rows for one granth, each carrying the library's city so the
 * caller can render "where" without a second query — and so a city_admin's UI
 * can tell which rows are theirs to touch.
 */
export async function availabilityForEntry(granthId: string) {
  return db
    .select({
      library_id: granth_availability.library_id,
      note: granth_availability.note,
      library_name_en: granth_libraries.draft_name_en,
      city_id: granth_libraries.draft_city_id,
      is_published: granth_libraries.is_published,
    })
    .from(granth_availability)
    .innerJoin(granth_libraries, eq(granth_libraries.id, granth_availability.library_id))
    .where(
      and(
        eq(granth_availability.granth_id, granthId),
        isNull(granth_libraries.deleted_at),
      ),
    );
}
