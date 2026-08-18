/**
 * /v1/admin/library/granth — v3 §17.11.5 Granth directory administration.
 *
 * Mounted under the library admin router, so it inherits the city_admin gate
 * that keeps sanchalak and shikshak out entirely. Everything finer than that —
 * a city_admin confined to their own city, entries reserved to state_admin+ —
 * is enforced per handler in `granth-admin.ts`, because one mount point carries
 * three different authorities and a guard can only express one.
 *
 * Every write is audited and soft-deletes; nothing here hard-deletes a row.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  cities,
  db,
  granth_availability,
  granth_entries,
  granth_libraries,
  library_items,
} from "@workspace/db";
import {
  contactPhoneToE164,
  granthAvailabilityWriteSchema,
  granthEntryWriteSchema,
  granthLibraryWriteSchema,
  granthReorderSchema,
} from "@workspace/api-zod";
import { and, asc, desc, eq, ilike, inArray, isNull, max, or } from "drizzle-orm";

import { ok, fail } from "../../lib/envelope";
import { auditFromReq } from "../../lib/audit";
import { zodDetails } from "../../lib/panchang-schema";
import { UUID_RE } from "../../lib/validation";
import { userCanAccessCity } from "../../lib/scope";
import {
  GranthForbiddenError,
  GranthNotFoundError,
  assertCanManageEntries,
  assertCanWriteAvailability,
  assertCanWriteLibrary,
  assertLibraryCityInScope,
  availabilityForEntry,
  canManageGranthEntries,
  loadEntry,
  loadLibrary,
  mapEntryAdmin,
  mapLibraryAdmin,
  publishGranthEntry,
  publishGranthLibrary,
  unpublishGranthEntry,
  unpublishGranthLibrary,
} from "../../lib/granth-admin";

const router: IRouter = Router();

/** Typed service errors → the envelope, so every handler reads the same. */
function failFromServiceError(res: Response, err: unknown): boolean {
  if (err instanceof GranthForbiddenError || err instanceof GranthNotFoundError) {
    fail(res, err.status, err.code, err.message);
    return true;
  }
  return false;
}

function requireUser(req: Request, res: Response) {
  const user = req.authUser;
  if (!user) {
    fail(res, 401, "ERR_UNAUTHENTICATED", "Sign in to manage the granth directory.");
    return null;
  }
  return user;
}

/* ── Libraries ────────────────────────────────────────────────────────────── */

/**
 * GET /libraries — the caller's own scope only.
 *
 * A city_admin never receives a library outside their city, so the UI cannot
 * offer them one to click. That is a convenience, not the guard: every write
 * below re-checks, because a hidden row is still an id someone can type.
 */
router.get("/libraries", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;

  const cityFilter = String(req.query["city_id"] ?? "");
  const rows = await db
    .select({ library: granth_libraries, city_name: cities.name })
    .from(granth_libraries)
    .innerJoin(cities, eq(cities.id, granth_libraries.draft_city_id))
    .where(
      and(
        isNull(granth_libraries.deleted_at),
        UUID_RE.test(cityFilter) ? eq(granth_libraries.draft_city_id, cityFilter) : undefined,
      ),
    )
    .orderBy(asc(granth_libraries.draft_order), asc(granth_libraries.draft_name_en));

  const visible = [];
  for (const row of rows) {
    if (await userCanAccessCity(user, row.library.draft_city_id)) {
      visible.push(mapLibraryAdmin(row.library, row.city_name));
    }
  }
  ok(res, { libraries: visible }, { count: visible.length });
});

/**
 * GET /cities — the cities this admin may file a library under.
 *
 * Feeds the editor's city picker. §17.11.5 says out-of-scope cities are hidden
 * from a city_admin; deriving the picker from this endpoint is what makes the
 * hiding follow the same rule the writes enforce, rather than a second one.
 */
router.get("/cities", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const rows = await db
    .select({ id: cities.id, name: cities.name })
    .from(cities)
    .orderBy(asc(cities.name));
  const visible = [];
  for (const row of rows) {
    if (await userCanAccessCity(user, row.id)) visible.push(row);
  }
  ok(res, { cities: visible }, { count: visible.length });
});

router.post("/libraries", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const parsed = granthLibraryWriteSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid library payload.", zodDetails(parsed.error));
    return;
  }
  const b = parsed.data;
  try {
    await assertLibraryCityInScope(user, [b.city_id]);
  } catch (err) {
    if (failFromServiceError(res, err)) return;
    throw err;
  }

  const [{ m } = { m: null }] = await db
    .select({ m: max(granth_libraries.draft_order) })
    .from(granth_libraries)
    .where(isNull(granth_libraries.deleted_at));
  const nextOrder = (m ?? -1) + 1;
  const phone = b.contact_phone ? contactPhoneToE164(b.contact_phone) : null;

  const [row] = await db
    .insert(granth_libraries)
    .values({
      // Live columns seeded alongside the draft, as library items do — the row
      // is invisible either way until is_published flips.
      name_en: b.name_en,
      name_hi: b.name_hi ?? null,
      address_en: b.address_en,
      address_hi: b.address_hi ?? null,
      city_id: b.city_id,
      contact_name: b.contact_name ?? null,
      contact_phone: phone,
      has_whatsapp: b.has_whatsapp ?? false,
      timings_en: b.timings_en ?? null,
      timings_hi: b.timings_hi ?? null,
      lat: b.lat != null ? String(b.lat) : null,
      lng: b.lng != null ? String(b.lng) : null,
      note_en: b.note_en ?? null,
      note_hi: b.note_hi ?? null,
      order: nextOrder,
      draft_name_en: b.name_en,
      draft_name_hi: b.name_hi ?? null,
      draft_address_en: b.address_en,
      draft_address_hi: b.address_hi ?? null,
      draft_city_id: b.city_id,
      draft_contact_name: b.contact_name ?? null,
      draft_contact_phone: phone,
      draft_has_whatsapp: b.has_whatsapp ?? false,
      draft_timings_en: b.timings_en ?? null,
      draft_timings_hi: b.timings_hi ?? null,
      draft_lat: b.lat != null ? String(b.lat) : null,
      draft_lng: b.lng != null ? String(b.lng) : null,
      draft_note_en: b.note_en ?? null,
      draft_note_hi: b.note_hi ?? null,
      draft_order: nextOrder,
      is_published: false,
      content_version: 1,
    })
    .returning();

  await auditFromReq(req, {
    action: "create",
    entityKind: "granth_library",
    entityId: row!.id,
    summary: `Granth library draft created (${b.name_en}).`,
  });
  ok(res, { library: mapLibraryAdmin(row!) });
});

router.patch("/libraries/:id", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const parsed = granthLibraryWriteSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid library payload.", zodDetails(parsed.error));
    return;
  }
  const b = parsed.data;
  try {
    const existing = await loadLibrary(String(req.params.id));
    await assertCanWriteLibrary(user, existing, b.city_id);

    const phone = b.contact_phone ? contactPhoneToE164(b.contact_phone) : null;
    const [row] = await db
      .update(granth_libraries)
      .set({
        draft_name_en: b.name_en,
        draft_name_hi: b.name_hi ?? null,
        draft_address_en: b.address_en,
        draft_address_hi: b.address_hi ?? null,
        draft_city_id: b.city_id,
        draft_contact_name: b.contact_name ?? null,
        draft_contact_phone: phone,
        draft_has_whatsapp: b.has_whatsapp ?? false,
        draft_timings_en: b.timings_en ?? null,
        draft_timings_hi: b.timings_hi ?? null,
        draft_lat: b.lat != null ? String(b.lat) : null,
        draft_lng: b.lng != null ? String(b.lng) : null,
        draft_note_en: b.note_en ?? null,
        draft_note_hi: b.note_hi ?? null,
        updated_at: new Date(),
      })
      .where(eq(granth_libraries.id, existing.id))
      .returning();

    await auditFromReq(req, {
      action: "update",
      entityKind: "granth_library",
      entityId: existing.id,
      summary: `Granth library draft updated (${b.name_en}).`,
    });
    ok(res, { library: mapLibraryAdmin(row!) });
  } catch (err) {
    if (failFromServiceError(res, err)) return;
    throw err;
  }
});

router.post("/libraries/reorder", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const parsed = granthReorderSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "ids must be a non-empty UUID array.", zodDetails(parsed.error));
    return;
  }
  const { ids } = parsed.data;
  try {
    // Every row in the list must be writable. A partial reorder would leave the
    // directory in an order nobody chose.
    const rows = await db
      .select({
        id: granth_libraries.id,
        city_id: granth_libraries.city_id,
        draft_city_id: granth_libraries.draft_city_id,
      })
      .from(granth_libraries)
      .where(and(inArray(granth_libraries.id, ids), isNull(granth_libraries.deleted_at)));
    if (rows.length !== ids.length) {
      throw new GranthNotFoundError("One of those libraries could not be found.");
    }
    for (const row of rows) await assertCanWriteLibrary(user, row);

    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx
          .update(granth_libraries)
          .set({ draft_order: i, updated_at: new Date() })
          .where(eq(granth_libraries.id, ids[i]!));
      }
    });
    await auditFromReq(req, {
      action: "update",
      entityKind: "granth_library",
      entityId: ids[0]!,
      summary: `Granth libraries reordered (${ids.length}).`,
    });
    ok(res, { reordered: ids.length });
  } catch (err) {
    if (failFromServiceError(res, err)) return;
    throw err;
  }
});

router.post("/libraries/:id/publish", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const existing = await loadLibrary(String(req.params.id));
    await assertCanWriteLibrary(user, existing);
    const updated = await publishGranthLibrary(existing.id);
    await auditFromReq(req, {
      action: "approve",
      entityKind: "granth_library",
      entityId: existing.id,
      summary: `Granth library published (${existing.draft_name_en}).`,
    });
    ok(res, { library: mapLibraryAdmin(updated!) });
  } catch (err) {
    if (failFromServiceError(res, err)) return;
    throw err;
  }
});

router.post("/libraries/:id/unpublish", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const existing = await loadLibrary(String(req.params.id));
    await assertCanWriteLibrary(user, existing);
    const updated = await unpublishGranthLibrary(existing.id);
    await auditFromReq(req, {
      action: "reject",
      entityKind: "granth_library",
      entityId: existing.id,
      summary: `Granth library unpublished (${existing.draft_name_en}).`,
    });
    ok(res, { library: mapLibraryAdmin(updated!) });
  } catch (err) {
    if (failFromServiceError(res, err)) return;
    throw err;
  }
});

router.delete("/libraries/:id", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const existing = await loadLibrary(String(req.params.id));
    await assertCanWriteLibrary(user, existing);
    // Soft delete only. The availability rows stay: restoring a library that
    // lost its catalogue would be a worse outcome than a few orphaned joins,
    // and the public directory filters on deleted_at anyway.
    await db
      .update(granth_libraries)
      .set({ deleted_at: new Date(), is_published: false, updated_at: new Date() })
      .where(eq(granth_libraries.id, existing.id));
    await auditFromReq(req, {
      action: "delete",
      entityKind: "granth_library",
      entityId: existing.id,
      summary: `Granth library deleted (${existing.draft_name_en}).`,
    });
    ok(res, { deleted: true });
  } catch (err) {
    if (failFromServiceError(res, err)) return;
    throw err;
  }
});

/* ── Entries (state_admin and above) ──────────────────────────────────────── */

router.get("/entries", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const q = String(req.query["q"] ?? "").trim();
  const rows = await db
    .select()
    .from(granth_entries)
    .where(
      and(
        isNull(granth_entries.deleted_at),
        q
          ? or(
              ilike(granth_entries.draft_title_en, `%${q}%`),
              ilike(granth_entries.draft_title_hi, `%${q}%`),
              ilike(granth_entries.draft_author_en, `%${q}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(granth_entries.draft_order), asc(granth_entries.draft_title_en));

  ok(
    res,
    {
      entries: rows.map(mapEntryAdmin),
      // The UI hides the write actions from a city_admin; the service refuses
      // them regardless. Shipping the flag keeps the two from disagreeing.
      can_manage: canManageGranthEntries(user.role),
    },
    { count: rows.length },
  );
});

router.get("/entries/:id", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const row = await loadEntry(String(req.params.id));
    ok(res, {
      entry: mapEntryAdmin(row),
      availability: await availabilityForEntry(row.id),
      can_manage: canManageGranthEntries(user.role),
    });
  } catch (err) {
    if (failFromServiceError(res, err)) return;
    throw err;
  }
});

router.post("/entries", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const parsed = granthEntryWriteSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid granth payload.", zodDetails(parsed.error));
    return;
  }
  const b = parsed.data;
  try {
    assertCanManageEntries(user);
    await assertLinkedItemExists(b.linked_item_id);

    const [{ m } = { m: null }] = await db
      .select({ m: max(granth_entries.draft_order) })
      .from(granth_entries)
      .where(isNull(granth_entries.deleted_at));
    const nextOrder = (m ?? -1) + 1;

    const [row] = await db
      .insert(granth_entries)
      .values({
        title_en: b.title_en,
        title_hi: b.title_hi ?? null,
        author_en: b.author_en ?? null,
        author_hi: b.author_hi ?? null,
        language: b.language ?? null,
        description_en: b.description_en ?? null,
        description_hi: b.description_hi ?? null,
        linked_item_id: b.linked_item_id ?? null,
        order: nextOrder,
        draft_title_en: b.title_en,
        draft_title_hi: b.title_hi ?? null,
        draft_author_en: b.author_en ?? null,
        draft_author_hi: b.author_hi ?? null,
        draft_language: b.language ?? null,
        draft_description_en: b.description_en ?? null,
        draft_description_hi: b.description_hi ?? null,
        draft_linked_item_id: b.linked_item_id ?? null,
        draft_order: nextOrder,
        is_published: false,
        content_version: 1,
      })
      .returning();

    await auditFromReq(req, {
      action: "create",
      entityKind: "granth_entry",
      entityId: row!.id,
      summary: `Granth draft created (${b.title_en}).`,
    });
    ok(res, { entry: mapEntryAdmin(row!) });
  } catch (err) {
    if (failFromServiceError(res, err)) return;
    throw err;
  }
});

router.patch("/entries/:id", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const parsed = granthEntryWriteSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid granth payload.", zodDetails(parsed.error));
    return;
  }
  const b = parsed.data;
  try {
    assertCanManageEntries(user);
    const existing = await loadEntry(String(req.params.id));
    await assertLinkedItemExists(b.linked_item_id);

    const [row] = await db
      .update(granth_entries)
      .set({
        draft_title_en: b.title_en,
        draft_title_hi: b.title_hi ?? null,
        draft_author_en: b.author_en ?? null,
        draft_author_hi: b.author_hi ?? null,
        draft_language: b.language ?? null,
        draft_description_en: b.description_en ?? null,
        draft_description_hi: b.description_hi ?? null,
        draft_linked_item_id: b.linked_item_id ?? null,
        updated_at: new Date(),
      })
      .where(eq(granth_entries.id, existing.id))
      .returning();

    await auditFromReq(req, {
      action: "update",
      entityKind: "granth_entry",
      entityId: existing.id,
      summary: `Granth draft updated (${b.title_en}).`,
    });
    ok(res, { entry: mapEntryAdmin(row!) });
  } catch (err) {
    if (failFromServiceError(res, err)) return;
    throw err;
  }
});

router.post("/entries/reorder", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const parsed = granthReorderSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "ids must be a non-empty UUID array.", zodDetails(parsed.error));
    return;
  }
  try {
    assertCanManageEntries(user);
    const { ids } = parsed.data;
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx
          .update(granth_entries)
          .set({ draft_order: i, updated_at: new Date() })
          .where(and(eq(granth_entries.id, ids[i]!), isNull(granth_entries.deleted_at)));
      }
    });
    await auditFromReq(req, {
      action: "update",
      entityKind: "granth_entry",
      entityId: ids[0]!,
      summary: `Granths reordered (${ids.length}).`,
    });
    ok(res, { reordered: ids.length });
  } catch (err) {
    if (failFromServiceError(res, err)) return;
    throw err;
  }
});

router.post("/entries/:id/publish", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    assertCanManageEntries(user);
    const existing = await loadEntry(String(req.params.id));
    const updated = await publishGranthEntry(existing.id);
    await auditFromReq(req, {
      action: "approve",
      entityKind: "granth_entry",
      entityId: existing.id,
      summary: `Granth published (${existing.draft_title_en}).`,
    });
    ok(res, { entry: mapEntryAdmin(updated!) });
  } catch (err) {
    if (failFromServiceError(res, err)) return;
    throw err;
  }
});

router.post("/entries/:id/unpublish", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    assertCanManageEntries(user);
    const existing = await loadEntry(String(req.params.id));
    const updated = await unpublishGranthEntry(existing.id);
    await auditFromReq(req, {
      action: "reject",
      entityKind: "granth_entry",
      entityId: existing.id,
      summary: `Granth unpublished (${existing.draft_title_en}).`,
    });
    ok(res, { entry: mapEntryAdmin(updated!) });
  } catch (err) {
    if (failFromServiceError(res, err)) return;
    throw err;
  }
});

router.delete("/entries/:id", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    assertCanManageEntries(user);
    const existing = await loadEntry(String(req.params.id));
    await db
      .update(granth_entries)
      .set({ deleted_at: new Date(), is_published: false, updated_at: new Date() })
      .where(eq(granth_entries.id, existing.id));
    await auditFromReq(req, {
      action: "delete",
      entityKind: "granth_entry",
      entityId: existing.id,
      summary: `Granth deleted (${existing.draft_title_en}).`,
    });
    ok(res, { deleted: true });
  } catch (err) {
    if (failFromServiceError(res, err)) return;
    throw err;
  }
});

/* ── Availability (governed by the LIBRARY's city) ────────────────────────── */

router.put("/entries/:id/availability", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const parsed = granthAvailabilityWriteSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid availability payload.", zodDetails(parsed.error));
    return;
  }
  const b = parsed.data;
  try {
    const entry = await loadEntry(String(req.params.id));
    // §17.11.5 — a city_admin manages availability where the LIBRARY is theirs,
    // even though the granth itself is a state-level record. Shelf facts belong
    // to whoever runs the shelf.
    await assertCanWriteAvailability(user, b.library_id);

    await db
      .insert(granth_availability)
      .values({ granth_id: entry.id, library_id: b.library_id, note: b.note ?? null })
      .onConflictDoUpdate({
        target: [granth_availability.granth_id, granth_availability.library_id],
        set: { note: b.note ?? null },
      });

    await auditFromReq(req, {
      action: "update",
      entityKind: "granth_availability",
      entityId: entry.id,
      summary: `Granth availability set (${existingSummary(entry.draft_title_en, b.library_id)}).`,
    });
    ok(res, { availability: await availabilityForEntry(entry.id) });
  } catch (err) {
    if (failFromServiceError(res, err)) return;
    throw err;
  }
});

router.delete("/entries/:id/availability/:libraryId", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const entry = await loadEntry(String(req.params.id));
    const libraryId = String(req.params.libraryId);
    await assertCanWriteAvailability(user, libraryId);

    // A join row is a fact about a shelf, not content — there is nothing to
    // soft-delete and nothing to restore.
    await db
      .delete(granth_availability)
      .where(
        and(
          eq(granth_availability.granth_id, entry.id),
          eq(granth_availability.library_id, libraryId),
        ),
      );

    await auditFromReq(req, {
      action: "delete",
      entityKind: "granth_availability",
      entityId: entry.id,
      summary: `Granth availability removed (${existingSummary(entry.draft_title_en, libraryId)}).`,
    });
    ok(res, { availability: await availabilityForEntry(entry.id) });
  } catch (err) {
    if (failFromServiceError(res, err)) return;
    throw err;
  }
});

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function existingSummary(title: string, libraryId: string): string {
  return `${title} @ ${libraryId}`;
}

/**
 * A linked item must exist and not be soft-deleted. It need not be published:
 * an admin routinely links a granth to an item they are about to publish, and
 * refusing that would force them to do the two in a particular order.
 */
async function assertLinkedItemExists(itemId: string | null | undefined): Promise<void> {
  if (!itemId) return;
  const [row] = await db
    .select({ id: library_items.id })
    .from(library_items)
    .where(and(eq(library_items.id, itemId), isNull(library_items.deleted_at)))
    .limit(1);
  if (!row) {
    throw new GranthNotFoundError("That library item could not be found — pick another.");
  }
}

/**
 * GET /library-items?q= — the picker behind linked_item_id.
 *
 * Titles and codes only: the picker needs to identify an item, not render it,
 * and shipping full text content into an admin dropdown would be a payload
 * measured in megabytes.
 */
router.get("/library-items", async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const q = String(req.query["q"] ?? "").trim();
  const rows = await db
    .select({
      id: library_items.id,
      item_code: library_items.item_code,
      title_en: library_items.draft_title_en,
      title_hi: library_items.draft_title_hi,
      is_published: library_items.is_published,
    })
    .from(library_items)
    .where(
      and(
        isNull(library_items.deleted_at),
        q
          ? or(
              ilike(library_items.draft_title_en, `%${q}%`),
              ilike(library_items.draft_title_hi, `%${q}%`),
              ilike(library_items.item_code, `%${q}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(library_items.is_published), asc(library_items.draft_title_en))
    .limit(50);
  ok(res, { items: rows }, { count: rows.length, truncated: rows.length === 50 });
});

export default router;

