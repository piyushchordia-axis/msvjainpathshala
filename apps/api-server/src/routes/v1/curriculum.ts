/**
 * /v1/curriculum — section + item authoring for an existing curriculum.
 *
 * The parent curriculum shell is created elsewhere (admin-modules.ts). This
 * router owns the MISSING children CRUD: create/update/delete/reorder of
 * curriculum_sections and curriculum_items. Without it an admin-created
 * curriculum is permanently empty.
 *
 * Authoring is CITY-scoped via the parent curriculum's city_id:
 *  - A city-scoped curriculum (city_id set) may be authored only by an admin
 *    whose city scope covers that city.
 *  - A CENTRAL / MSV curriculum (city_id IS NULL) is national content, gated to
 *    super_admin / state_admin only — a city_admin must not author national
 *    curricula. (state_admin authoring of central content is intentionally
 *    allowed, matching how national content is curated.)
 *
 * Every mutation is audited. Reorder is transactional so a partial reorder can
 * never leave inconsistent order_index values.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  centres,
  cities,
  curricula,
  curriculum_sections,
  curriculum_items,
  type User,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";

const router: IRouter = Router();
router.use(requireAuth, requireAdminPanel);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---- city scope: null = all (super_admin); [] = nothing; else city ids ---- */
async function cityScopeForUser(user: User): Promise<string[] | null> {
  if (user.role === "super_admin") return null;
  if (user.role === "city_admin") return user.city_id ? [user.city_id] : [];
  if (user.role === "state_admin") {
    if (!user.state_id) return [];
    const rows = await db
      .select({ id: cities.id })
      .from(cities)
      .where(eq(cities.state_id, user.state_id));
    return rows.map((r) => r.id);
  }
  const scope = await resolveAdminScope(user);
  if (scope.centreIds === null) return null;
  if (scope.centreIds.length === 0) return [];
  const rows = await db
    .select({ city_id: centres.city_id })
    .from(centres)
    .where(inArray(centres.id, scope.centreIds));
  return Array.from(new Set(rows.map((r) => r.city_id)));
}

function cityInScope(cityIds: string[] | null, cityId: string | null): boolean {
  if (cityIds === null) return true;
  if (!cityId) return false;
  return cityIds.includes(cityId);
}

/**
 * Roles allowed to author CENTRAL / MSV (city-agnostic) curricula. A city_admin
 * is deliberately excluded so they cannot edit national content.
 */
const NATIONAL_AUTHOR_ROLES = ["super_admin", "state_admin"];

/**
 * Load a curriculum and enforce the caller may AUTHOR its children.
 * Returns the curriculum on success; otherwise writes the response and
 * returns null (callers must early-return when null).
 */
async function loadAuthorableCurriculum(
  req: Request,
  res: Response,
  curriculumId: string,
): Promise<{ id: string; city_id: string | null } | null> {
  if (!UUID_RE.test(curriculumId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Curriculum not found.");
    return null;
  }
  const [curriculum] = await db
    .select({ id: curricula.id, city_id: curricula.city_id })
    .from(curricula)
    .where(eq(curricula.id, curriculumId))
    .limit(1);
  if (!curriculum) {
    fail(res, 404, "ERR_NOT_FOUND", "Curriculum not found.");
    return null;
  }

  // Central / MSV (no city) content: only national authors.
  if (!curriculum.city_id) {
    if (!NATIONAL_AUTHOR_ROLES.includes(req.authUser!.role)) {
      fail(res, 403, "ERR_FORBIDDEN", "Only state or super admins may author central curricula.");
      return null;
    }
    return curriculum;
  }

  // City-scoped content: the curriculum's city must be in the caller's scope.
  const cityIds = await cityScopeForUser(req.authUser!);
  if (!cityInScope(cityIds, curriculum.city_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Curriculum not found in your scope.");
    return null;
  }
  return curriculum;
}

/**
 * Load a section together with its parent curriculum, gating authorability.
 * Returns { section, curriculum } or null (response already written).
 */
async function loadAuthorableSection(
  req: Request,
  res: Response,
  sectionId: string,
): Promise<{ section: { id: string; curriculum_id: string }; curriculum: { id: string; city_id: string | null } } | null> {
  if (!UUID_RE.test(sectionId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Section not found.");
    return null;
  }
  const [section] = await db
    .select({ id: curriculum_sections.id, curriculum_id: curriculum_sections.curriculum_id })
    .from(curriculum_sections)
    .where(eq(curriculum_sections.id, sectionId))
    .limit(1);
  if (!section) {
    fail(res, 404, "ERR_NOT_FOUND", "Section not found.");
    return null;
  }
  const curriculum = await loadAuthorableCurriculum(req, res, section.curriculum_id);
  if (!curriculum) return null;
  return { section, curriculum };
}

/**
 * Load an item together with its section + parent curriculum, gating
 * authorability. Returns { item, section, curriculum } or null.
 */
async function loadAuthorableItem(
  req: Request,
  res: Response,
  itemId: string,
): Promise<
  | {
      item: { id: string; section_id: string };
      section: { id: string; curriculum_id: string };
      curriculum: { id: string; city_id: string | null };
    }
  | null
> {
  if (!UUID_RE.test(itemId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Item not found.");
    return null;
  }
  const [row] = await db
    .select({
      item_id: curriculum_items.id,
      section_id: curriculum_items.section_id,
      curriculum_id: curriculum_sections.curriculum_id,
    })
    .from(curriculum_items)
    .innerJoin(curriculum_sections, eq(curriculum_sections.id, curriculum_items.section_id))
    .where(eq(curriculum_items.id, itemId))
    .limit(1);
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "Item not found.");
    return null;
  }
  const curriculum = await loadAuthorableCurriculum(req, res, row.curriculum_id);
  if (!curriculum) return null;
  return {
    item: { id: row.item_id, section_id: row.section_id },
    section: { id: row.section_id, curriculum_id: row.curriculum_id },
    curriculum,
  };
}

/* ═══════════════════════════ SECTIONS ═══════════════════════════ */

const createSectionSchema = z.object({
  title_en: z.string().min(1).max(300),
  title_hi: z.string().min(1).max(300),
});

/* POST /v1/curriculum/:curriculumId/sections — add a section (appended to end) */
router.post("/:curriculumId/sections", async (req: Request, res: Response) => {
  let body: z.infer<typeof createSectionSchema>;
  try {
    body = createSectionSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid section data.");
    return;
  }
  const curriculum = await loadAuthorableCurriculum(req, res, String(req.params.curriculumId));
  if (!curriculum) return;

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${curriculum_sections.order_index}), -1)::int` })
    .from(curriculum_sections)
    .where(eq(curriculum_sections.curriculum_id, curriculum.id));

  const [row] = await db
    .insert(curriculum_sections)
    .values({
      curriculum_id: curriculum.id,
      title_en: body.title_en,
      title_hi: body.title_hi,
      order_index: (max ?? -1) + 1,
    })
    .returning({ id: curriculum_sections.id });

  await auditFromReq(req, {
    action: "create",
    entityKind: "curriculum_section",
    entityId: row.id,
    summary: `Added curriculum section "${body.title_en}".`,
    metadata: { curriculum_id: curriculum.id },
  });

  ok(res, { id: row.id });
});

const updateSectionSchema = z
  .object({
    title_en: z.string().min(1).max(300).optional(),
    title_hi: z.string().min(1).max(300).optional(),
  })
  .refine((b) => b.title_en !== undefined || b.title_hi !== undefined, {
    message: "Provide at least one field to update.",
  });

/* PATCH /v1/curriculum/sections/:sectionId — rename a section */
router.patch("/sections/:sectionId", async (req: Request, res: Response) => {
  let body: z.infer<typeof updateSectionSchema>;
  try {
    body = updateSectionSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid section data.");
    return;
  }
  const loaded = await loadAuthorableSection(req, res, String(req.params.sectionId));
  if (!loaded) return;

  await db
    .update(curriculum_sections)
    .set({
      ...(body.title_en !== undefined ? { title_en: body.title_en } : {}),
      ...(body.title_hi !== undefined ? { title_hi: body.title_hi } : {}),
      updated_at: new Date(),
    })
    .where(eq(curriculum_sections.id, loaded.section.id));

  await auditFromReq(req, {
    action: "update",
    entityKind: "curriculum_section",
    entityId: loaded.section.id,
    summary: "Updated curriculum section.",
    metadata: { curriculum_id: loaded.curriculum.id },
  });

  ok(res, { id: loaded.section.id });
});

/* DELETE /v1/curriculum/sections/:sectionId — delete a section (items cascade) */
router.delete("/sections/:sectionId", async (req: Request, res: Response) => {
  const loaded = await loadAuthorableSection(req, res, String(req.params.sectionId));
  if (!loaded) return;

  await db.delete(curriculum_sections).where(eq(curriculum_sections.id, loaded.section.id));

  await auditFromReq(req, {
    action: "delete",
    entityKind: "curriculum_section",
    entityId: loaded.section.id,
    summary: "Deleted curriculum section.",
    metadata: { curriculum_id: loaded.curriculum.id },
  });

  ok(res, { id: loaded.section.id, deleted: true });
});

const reorderSectionsSchema = z.object({
  section_ids: z.array(z.string().uuid()).min(1).max(500),
});

/* POST /v1/curriculum/:curriculumId/sections/reorder — set section order */
router.post("/:curriculumId/sections/reorder", async (req: Request, res: Response) => {
  let body: z.infer<typeof reorderSectionsSchema>;
  try {
    body = reorderSectionsSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid reorder data.");
    return;
  }
  const curriculum = await loadAuthorableCurriculum(req, res, String(req.params.curriculumId));
  if (!curriculum) return;

  // The submitted ids must be EXACTLY this curriculum's sections (no foreign or
  // missing ids), so a reorder can never re-parent or drop a section.
  const existing = await db
    .select({ id: curriculum_sections.id })
    .from(curriculum_sections)
    .where(eq(curriculum_sections.curriculum_id, curriculum.id));
  const existingIds = new Set(existing.map((r) => r.id));
  const submitted = new Set(body.section_ids);
  if (
    submitted.size !== body.section_ids.length ||
    submitted.size !== existingIds.size ||
    body.section_ids.some((id) => !existingIds.has(id))
  ) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Reorder must list every section exactly once.");
    return;
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < body.section_ids.length; i += 1) {
      await tx
        .update(curriculum_sections)
        .set({ order_index: i, updated_at: new Date() })
        .where(eq(curriculum_sections.id, body.section_ids[i]));
    }
  });

  await auditFromReq(req, {
    action: "update",
    entityKind: "curriculum",
    entityId: curriculum.id,
    summary: "Reordered curriculum sections.",
    metadata: { curriculum_id: curriculum.id, count: body.section_ids.length },
  });

  ok(res, { id: curriculum.id, reordered: body.section_ids.length });
});

/* ═══════════════════════════ ITEMS ═══════════════════════════ */

const createItemSchema = z.object({
  title_en: z.string().min(1).max(500),
  title_hi: z.string().min(1).max(500),
  description_en: z.string().max(4000).optional(),
  description_hi: z.string().max(4000).optional(),
});

/* POST /v1/curriculum/sections/:sectionId/items — add an item (appended to end) */
router.post("/sections/:sectionId/items", async (req: Request, res: Response) => {
  let body: z.infer<typeof createItemSchema>;
  try {
    body = createItemSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid item data.");
    return;
  }
  const loaded = await loadAuthorableSection(req, res, String(req.params.sectionId));
  if (!loaded) return;

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${curriculum_items.order_index}), -1)::int` })
    .from(curriculum_items)
    .where(eq(curriculum_items.section_id, loaded.section.id));

  const [row] = await db
    .insert(curriculum_items)
    .values({
      section_id: loaded.section.id,
      title_en: body.title_en,
      title_hi: body.title_hi,
      description_en: body.description_en ?? null,
      description_hi: body.description_hi ?? null,
      order_index: (max ?? -1) + 1,
    })
    .returning({ id: curriculum_items.id });

  await auditFromReq(req, {
    action: "create",
    entityKind: "curriculum_item",
    entityId: row.id,
    summary: `Added curriculum item "${body.title_en}".`,
    metadata: { curriculum_id: loaded.curriculum.id, section_id: loaded.section.id },
  });

  ok(res, { id: row.id });
});

const updateItemSchema = z
  .object({
    title_en: z.string().min(1).max(500).optional(),
    title_hi: z.string().min(1).max(500).optional(),
    description_en: z.string().max(4000).nullable().optional(),
    description_hi: z.string().max(4000).nullable().optional(),
  })
  .refine(
    (b) =>
      b.title_en !== undefined ||
      b.title_hi !== undefined ||
      b.description_en !== undefined ||
      b.description_hi !== undefined,
    { message: "Provide at least one field to update." },
  );

/* PATCH /v1/curriculum/items/:itemId — edit an item */
router.patch("/items/:itemId", async (req: Request, res: Response) => {
  let body: z.infer<typeof updateItemSchema>;
  try {
    body = updateItemSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid item data.");
    return;
  }
  const loaded = await loadAuthorableItem(req, res, String(req.params.itemId));
  if (!loaded) return;

  await db
    .update(curriculum_items)
    .set({
      ...(body.title_en !== undefined ? { title_en: body.title_en } : {}),
      ...(body.title_hi !== undefined ? { title_hi: body.title_hi } : {}),
      ...(body.description_en !== undefined ? { description_en: body.description_en } : {}),
      ...(body.description_hi !== undefined ? { description_hi: body.description_hi } : {}),
      updated_at: new Date(),
    })
    .where(eq(curriculum_items.id, loaded.item.id));

  await auditFromReq(req, {
    action: "update",
    entityKind: "curriculum_item",
    entityId: loaded.item.id,
    summary: "Updated curriculum item.",
    metadata: { curriculum_id: loaded.curriculum.id, section_id: loaded.section.id },
  });

  ok(res, { id: loaded.item.id });
});

/* DELETE /v1/curriculum/items/:itemId — delete an item */
router.delete("/items/:itemId", async (req: Request, res: Response) => {
  const loaded = await loadAuthorableItem(req, res, String(req.params.itemId));
  if (!loaded) return;

  await db.delete(curriculum_items).where(eq(curriculum_items.id, loaded.item.id));

  await auditFromReq(req, {
    action: "delete",
    entityKind: "curriculum_item",
    entityId: loaded.item.id,
    summary: "Deleted curriculum item.",
    metadata: { curriculum_id: loaded.curriculum.id, section_id: loaded.section.id },
  });

  ok(res, { id: loaded.item.id, deleted: true });
});

const reorderItemsSchema = z.object({
  item_ids: z.array(z.string().uuid()).min(1).max(2000),
});

/* POST /v1/curriculum/sections/:sectionId/items/reorder — set item order within a section */
router.post("/sections/:sectionId/items/reorder", async (req: Request, res: Response) => {
  let body: z.infer<typeof reorderItemsSchema>;
  try {
    body = reorderItemsSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid reorder data.");
    return;
  }
  const loaded = await loadAuthorableSection(req, res, String(req.params.sectionId));
  if (!loaded) return;

  // The submitted ids must be EXACTLY this section's items, so a reorder can
  // never re-parent an item into another section or drop one.
  const existing = await db
    .select({ id: curriculum_items.id })
    .from(curriculum_items)
    .where(eq(curriculum_items.section_id, loaded.section.id));
  const existingIds = new Set(existing.map((r) => r.id));
  const submitted = new Set(body.item_ids);
  if (
    submitted.size !== body.item_ids.length ||
    submitted.size !== existingIds.size ||
    body.item_ids.some((id) => !existingIds.has(id))
  ) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Reorder must list every item exactly once.");
    return;
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < body.item_ids.length; i += 1) {
      await tx
        .update(curriculum_items)
        .set({ order_index: i, updated_at: new Date() })
        .where(eq(curriculum_items.id, body.item_ids[i]));
    }
  });

  await auditFromReq(req, {
    action: "update",
    entityKind: "curriculum_section",
    entityId: loaded.section.id,
    summary: "Reordered curriculum items.",
    metadata: {
      curriculum_id: loaded.curriculum.id,
      section_id: loaded.section.id,
      count: body.item_ids.length,
    },
  });

  ok(res, { id: loaded.section.id, reordered: body.item_ids.length });
});

export default router;
