/**
 * /v1/gallery — public gallery + admin management + curation queue.
 *
 * Public (anonymous):
 *  - GET /?surface=wall|home — published + featured for that surface. Student-
 *    tied media also requires the owning user's gallery_visibility_opt_in (Q6).
 *    Featuring NEVER overrides consent.
 *
 * Admin panel (requireAuth + requireAdminPanel, centre-scoped):
 *  - POST /admin — create from uploaded gallery URL
 *  - GET /admin — list in scope (incl. hidden + non-opted-in)
 *  - PATCH /admin/:id/visibility — soft-hide (is_public only)
 *  - DELETE /admin/:id — soft-delete takedown
 *
 * Curation (requireAuth + canFeatureMedia — city_admin+, NOT sanchalak/shikshak):
 *  - PATCH /admin/:id/featured
 *  - PATCH /admin/featured (bulk, per-item results)
 *  - GET /admin/queue — moderation queue with explicit consent state
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  gallery_items,
  students,
  niyams,
  users,
  centres,
  type User,
} from "@workspace/db";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { canFeatureMedia } from "@workspace/api-zod";
import { ok, fail } from "../../lib/envelope";
import { httpUrl } from "../../lib/validation";
import { signUploadUrl, uploadKeyFromUrl } from "../../lib/file-tokens";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import { storage } from "../../lib/storage";
import { clampLimit, firstName, inScope } from "../../lib/route-helpers";
import { applyGalleryFeatureFlags } from "../../lib/gallery-feature";
import {
  enqueueGalleryWallFeatureNotifies,
  isGalleryWallFeatureTransition,
  notifyGalleryWallFeatureInline,
} from "../../lib/gallery-wall-notify";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireFeatureMedia(req: Request, res: Response): boolean {
  if (!canFeatureMedia(req.authUser?.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only city admins and above can feature gallery media.");
    return false;
  }
  return true;
}

async function cityIdForStudent(studentId: string): Promise<string | null> {
  const [row] = await db
    .select({ city_id: centres.city_id })
    .from(students)
    .innerJoin(centres, eq(centres.id, students.centre_id))
    .where(and(eq(students.id, studentId), isNull(students.deleted_at)))
    .limit(1);
  return row?.city_id ?? null;
}

/* ═══════════════════════════════ Public ═══════════════════════════════ */

/* GET /v1/gallery?surface=wall|home&limit= — featured + consent-gated */
router.get("/", async (req: Request, res: Response) => {
  const limit = clampLimit(req.query.limit, 60, 200);
  const surfaceRaw = String(req.query.surface ?? "wall").toLowerCase();
  const surface = surfaceRaw === "home" ? "home" : "wall";
  const featuredCol =
    surface === "home" ? gallery_items.featured_home : gallery_items.featured_gallery;

  const owner = users;
  const rows = await db
    .select({
      id: gallery_items.id,
      student_id: gallery_items.student_id,
      full_name: students.full_name,
      age_group: students.age_group,
      niyam_title_en: niyams.title_en,
      niyam_title_hi: niyams.title_hi,
      niyam_type: niyams.niyam_type,
      image_url: gallery_items.image_url,
      thumbnail_url: gallery_items.thumbnail_url,
      caption: gallery_items.caption,
      caption_hi: gallery_items.caption_hi,
      featured_gallery: gallery_items.featured_gallery,
      featured_home: gallery_items.featured_home,
      created_at: gallery_items.created_at,
    })
    .from(gallery_items)
    .leftJoin(students, eq(students.id, gallery_items.student_id))
    .leftJoin(niyams, eq(niyams.id, gallery_items.niyam_id))
    .leftJoin(owner, eq(owner.id, sql`coalesce(${students.parent_id}, ${students.user_id})`))
    .where(
      and(
        eq(gallery_items.is_public, true),
        eq(featuredCol, true),
        isNull(gallery_items.deleted_at),
        sql`${gallery_items.image_url} is not null`,
        // Q6 consent gate — featuring never overrides opt-out.
        or(
          isNull(gallery_items.student_id),
          eq(owner.gallery_visibility_opt_in, true),
        ),
      ),
    )
    .orderBy(desc(featuredCol), desc(gallery_items.created_at))
    .limit(limit);

  const items = rows.map((r) => ({
    id: r.id,
    first_name: r.student_id ? firstName(r.full_name) : "",
    age_group: r.age_group ?? "",
    niyam_title_en: r.niyam_title_en ?? "",
    niyam_title_hi: r.niyam_title_hi ?? "",
    niyam_type: r.niyam_type ?? "",
    image_url: signUploadUrl(r.image_url),
    thumbnail_url: signUploadUrl(r.thumbnail_url ?? r.image_url),
    caption: r.caption ?? null,
    caption_hi: r.caption_hi ?? null,
    featured_gallery: r.featured_gallery,
    featured_home: r.featured_home,
    /** @deprecated Wire alias of featured_gallery. */
    is_featured: r.featured_gallery,
    created_at: r.created_at.toISOString(),
  }));
  ok(res, { items }, { count: items.length, surface });
});

/* ═══════════════════════════════ Admin ═══════════════════════════════ */

const createSchema = z.object({
  image_url: httpUrl(1000),
  thumbnail_url: httpUrl(1000).optional(),
  caption: z.string().trim().max(500).optional(),
  caption_hi: z.string().trim().max(500).optional(),
  student_id: z.string().uuid().optional(),
  niyam_id: z.string().uuid().optional(),
  is_public: z.boolean().optional(),
});

/* POST /v1/gallery/admin — create (never auto-features) */
router.post("/admin", requireAuth, requireAdminPanel, async (req: Request, res: Response) => {
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid gallery item data.");
    return;
  }

  if (uploadKeyFromUrl(body.image_url) === null) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "image_url must be an uploaded file URL.");
    return;
  }

  const scope = await resolveAdminScope(req.authUser!);
  let cityId: string | null = null;

  if (body.student_id) {
    const [student] = await db
      .select({ id: students.id, centre_id: students.centre_id })
      .from(students)
      .where(and(eq(students.id, body.student_id), isNull(students.deleted_at)))
      .limit(1);
    if (!student) {
      fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
      return;
    }
    if (!inScope(scope, student.centre_id)) {
      fail(res, 403, "ERR_FORBIDDEN", "Student is outside your scope.");
      return;
    }
    cityId = await cityIdForStudent(body.student_id);
  } else if (scope.centreIds !== null && scope.centreIds.length === 0) {
    fail(res, 403, "ERR_FORBIDDEN", "You cannot publish non-student media.");
    return;
  }

  if (body.niyam_id) {
    if (!body.student_id) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "niyam_id requires a student_id.");
      return;
    }
    const [niyam] = await db
      .select({ id: niyams.id })
      .from(niyams)
      .where(eq(niyams.id, body.niyam_id))
      .limit(1);
    if (!niyam) {
      fail(res, 404, "ERR_NOT_FOUND", "Niyam not found.");
      return;
    }
  }

  const [row] = await db
    .insert(gallery_items)
    .values({
      student_id: body.student_id ?? null,
      niyam_id: body.niyam_id ?? null,
      city_id: cityId,
      image_url: body.image_url,
      thumbnail_url: body.thumbnail_url ?? null,
      caption: body.caption ?? null,
      caption_hi: body.caption_hi ?? null,
      is_public: body.is_public ?? true,
      featured_gallery: false,
      featured_home: false,
      created_by: req.authUser!.id,
    })
    .returning({
      id: gallery_items.id,
      is_public: gallery_items.is_public,
      featured_gallery: gallery_items.featured_gallery,
      featured_home: gallery_items.featured_home,
    });

  await auditFromReq(req, {
    action: "create",
    entityKind: "gallery_item",
    entityId: row.id,
    summary: body.student_id
      ? "Created a student gallery item."
      : "Created a gallery item.",
    metadata: { student_id: body.student_id ?? null, niyam_id: body.niyam_id ?? null },
  });

  ok(
    res,
    {
      id: row.id,
      is_public: row.is_public,
      featured_gallery: row.featured_gallery,
      featured_home: row.featured_home,
      is_featured: row.featured_gallery,
    },
    undefined,
    201,
  );
});

/* GET /v1/gallery/admin?limit= — admin listing */
router.get("/admin", requireAuth, requireAdminPanel, async (req: Request, res: Response) => {
  const limit = clampLimit(req.query.limit, 100, 500);
  const scope = await resolveAdminScope(req.authUser!);

  const owner = users;
  let scopeWhere;
  if (scope.centreIds === null) {
    scopeWhere = undefined;
  } else if (scope.centreIds.length === 0) {
    scopeWhere = isNull(gallery_items.student_id);
  } else {
    scopeWhere = or(
      isNull(gallery_items.student_id),
      inArray(students.centre_id, scope.centreIds),
    );
  }

  const rows = await db
    .select({
      id: gallery_items.id,
      student_id: gallery_items.student_id,
      full_name: students.full_name,
      age_group: students.age_group,
      centre_name: centres.name,
      niyam_title_en: niyams.title_en,
      image_url: gallery_items.image_url,
      thumbnail_url: gallery_items.thumbnail_url,
      caption: gallery_items.caption,
      caption_hi: gallery_items.caption_hi,
      featured_gallery: gallery_items.featured_gallery,
      featured_home: gallery_items.featured_home,
      is_public: gallery_items.is_public,
      created_at: gallery_items.created_at,
      opt_in: owner.gallery_visibility_opt_in,
    })
    .from(gallery_items)
    .leftJoin(students, eq(students.id, gallery_items.student_id))
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .leftJoin(niyams, eq(niyams.id, gallery_items.niyam_id))
    .leftJoin(owner, eq(owner.id, sql`coalesce(${students.parent_id}, ${students.user_id})`))
    .where(and(isNull(gallery_items.deleted_at), scopeWhere))
    .orderBy(desc(gallery_items.created_at))
    .limit(limit);

  const items = rows.map((r) => ({
    id: r.id,
    student_id: r.student_id,
    first_name: r.student_id ? firstName(r.full_name) : "",
    age_group: r.age_group ?? "",
    centre_name: r.centre_name ?? null,
    niyam_title_en: r.niyam_title_en ?? null,
    image_url: signUploadUrl(r.image_url),
    thumbnail_url: signUploadUrl(r.thumbnail_url ?? r.image_url),
    caption: r.caption ?? null,
    caption_hi: r.caption_hi ?? null,
    featured_gallery: r.featured_gallery,
    featured_home: r.featured_home,
    is_featured: r.featured_gallery,
    is_public: r.is_public,
    consent_opt_in: r.student_id ? Boolean(r.opt_in) : null,
    created_at: r.created_at.toISOString(),
  }));
  ok(res, { items }, { count: items.length });
});

/** Load a non-deleted item + its student's centre, enforcing caller scope. */
async function loadScopedItem(
  req: Request,
  id: string,
): Promise<{ id: string; student_id: string | null; image_url: string | null; thumbnail_url: string | null } | null> {
  const scope = await resolveAdminScope(req.authUser!);
  const [row] = await db
    .select({
      id: gallery_items.id,
      student_id: gallery_items.student_id,
      centre_id: students.centre_id,
      image_url: gallery_items.image_url,
      thumbnail_url: gallery_items.thumbnail_url,
    })
    .from(gallery_items)
    .leftJoin(students, eq(students.id, gallery_items.student_id))
    .where(and(eq(gallery_items.id, id), isNull(gallery_items.deleted_at)))
    .limit(1);
  if (!row) return null;
  if (row.student_id === null) {
    if (scope.centreIds !== null && scope.centreIds.length === 0) return null;
  } else if (!inScope(scope, row.centre_id)) {
    return null;
  }
  return {
    id: row.id,
    student_id: row.student_id,
    image_url: row.image_url,
    thumbnail_url: row.thumbnail_url,
  };
}

const visibilitySchema = z.object({
  is_public: z.boolean(),
});

/* PATCH /v1/gallery/admin/:id/visibility — soft-hide only (is_public) */
router.patch(
  "/admin/:id/visibility",
  requireAuth,
  requireAdminPanel,
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Gallery item not found.");
      return;
    }
    let body: z.infer<typeof visibilitySchema>;
    try {
      body = visibilitySchema.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Provide is_public.");
      return;
    }
    const item = await loadScopedItem(req, id);
    if (!item) {
      fail(res, 404, "ERR_NOT_FOUND", "Gallery item not found.");
      return;
    }

    const [row] = await db
      .update(gallery_items)
      .set({ is_public: body.is_public, updated_at: new Date() })
      .where(and(eq(gallery_items.id, id), isNull(gallery_items.deleted_at)))
      .returning({
        id: gallery_items.id,
        is_public: gallery_items.is_public,
        featured_gallery: gallery_items.featured_gallery,
        featured_home: gallery_items.featured_home,
      });
    if (!row) {
      fail(res, 404, "ERR_NOT_FOUND", "Gallery item not found.");
      return;
    }

    await auditFromReq(req, {
      action: "config_change",
      entityKind: "gallery_item",
      entityId: id,
      summary: "Updated gallery item visibility.",
      metadata: { is_public: row.is_public },
    });

    ok(res, {
      id: row.id,
      is_public: row.is_public,
      featured_gallery: row.featured_gallery,
      featured_home: row.featured_home,
      is_featured: row.featured_gallery,
    });
  },
);

const featureSchema = z
  .object({
    featured_home: z.boolean().optional(),
    featured_gallery: z.boolean().optional(),
  })
  .refine((v) => v.featured_home !== undefined || v.featured_gallery !== undefined, {
    message: "Provide featured_home and/or featured_gallery.",
  });

/* PATCH /v1/gallery/admin/:id/featured — city_admin+ curation */
router.patch(
  "/admin/:id/featured",
  requireAuth,
  async (req: Request, res: Response) => {
    if (!requireFeatureMedia(req, res)) return;
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Gallery item not found.");
      return;
    }
    let body: z.infer<typeof featureSchema>;
    try {
      body = featureSchema.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Provide featured_home and/or featured_gallery.");
      return;
    }

    const outcome = await applyGalleryFeatureFlags(req.authUser as User, id, body);
    if (outcome.result === "not_found") {
      fail(res, 404, "ERR_NOT_FOUND", "Gallery item not found.");
      return;
    }
    if (outcome.result === "forbidden") {
      fail(res, 403, "ERR_FORBIDDEN", "You may not feature this gallery item.");
      return;
    }

    await auditFromReq(req, {
      action: "update",
      entityKind: "gallery_item",
      entityId: id,
      summary: "Updated gallery item featuring.",
      metadata: {
        old: outcome.old,
        new: {
          featured_home: outcome.row!.featured_home,
          featured_gallery: outcome.row!.featured_gallery,
        },
      },
    });

    if (isGalleryWallFeatureTransition(outcome.old, outcome.row)) {
      // Single-item: notify inline (prefs-gated inside notifyUsers).
      void notifyGalleryWallFeatureInline(id);
    }

    ok(res, {
      id: outcome.row!.id,
      featured_home: outcome.row!.featured_home,
      featured_gallery: outcome.row!.featured_gallery,
      featured_at: outcome.row!.featured_at?.toISOString() ?? null,
      featured_by: outcome.row!.featured_by,
    });
  },
);

const bulkFeatureSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(100),
    featured_home: z.boolean().optional(),
    featured_gallery: z.boolean().optional(),
  })
  .refine((v) => v.featured_home !== undefined || v.featured_gallery !== undefined, {
    message: "Provide featured_home and/or featured_gallery.",
  });

/* PATCH /v1/gallery/admin/featured — bulk; per-item results (like attendance) */
router.patch("/admin/featured", requireAuth, async (req: Request, res: Response) => {
  if (!requireFeatureMedia(req, res)) return;
  let body: z.infer<typeof bulkFeatureSchema>;
  try {
    body = bulkFeatureSchema.parse(req.body);
  } catch {
    fail(
      res,
      422,
      "ERR_VALIDATION_FAILED",
      "Provide ids (1–100) and featured_home and/or featured_gallery.",
    );
    return;
  }

  const actor = req.authUser as User;
  const results: Array<{ id: string; result: "applied" | "forbidden" | "not_found" }> = [];
  const wallFeaturedIds: string[] = [];
  for (const id of body.ids) {
    const outcome = await applyGalleryFeatureFlags(actor, id, {
      featured_home: body.featured_home,
      featured_gallery: body.featured_gallery,
    });
    results.push({ id, result: outcome.result });
    if (outcome.result === "applied" && outcome.row && outcome.old) {
      await auditFromReq(req, {
        action: "update",
        entityKind: "gallery_item",
        entityId: id,
        summary: "Bulk-updated gallery item featuring.",
        metadata: {
          old: outcome.old,
          new: {
            featured_home: outcome.row.featured_home,
            featured_gallery: outcome.row.featured_gallery,
          },
        },
      });
      if (isGalleryWallFeatureTransition(outcome.old, outcome.row)) {
        wallFeaturedIds.push(id);
      }
    }
  }

  // Bulk: enqueue so N featuring transitions do not send N pushes inline.
  if (wallFeaturedIds.length > 0) {
    void enqueueGalleryWallFeatureNotifies(wallFeaturedIds);
  }

  ok(res, { results });
});

/* GET /v1/gallery/admin/queue — curation queue with consent state */
router.get("/admin/queue", requireAuth, async (req: Request, res: Response) => {
  if (!requireFeatureMedia(req, res)) return;

  const limit = clampLimit(req.query.limit, 50, 200);
  const featuredFilter = String(req.query.featured ?? "none").toLowerCase();
  const cityFilter =
    typeof req.query.city_id === "string" && UUID_RE.test(req.query.city_id)
      ? req.query.city_id
      : null;
  const cursor =
    typeof req.query.cursor === "string" && req.query.cursor.length > 0
      ? new Date(req.query.cursor)
      : null;

  const actor = req.authUser as User;
  const owner = users;

  const conditions = [isNull(gallery_items.deleted_at)];

  if (featuredFilter === "none") {
    conditions.push(eq(gallery_items.featured_gallery, false));
    conditions.push(eq(gallery_items.featured_home, false));
  } else if (featuredFilter === "home") {
    conditions.push(eq(gallery_items.featured_home, true));
  } else if (featuredFilter === "wall") {
    conditions.push(eq(gallery_items.featured_gallery, true));
  }
  // 'any' → no flag filter

  if (cityFilter) {
    conditions.push(eq(gallery_items.city_id, cityFilter));
  }

  // Geographic scope via denormalised city_id.
  if (actor.role === "city_admin") {
    if (!actor.city_id) {
      ok(res, { items: [] }, { count: 0 });
      return;
    }
    conditions.push(eq(gallery_items.city_id, actor.city_id));
  } else if (actor.role === "state_admin") {
    if (!actor.state_id) {
      ok(res, { items: [] }, { count: 0 });
      return;
    }
    const cityRows = await db
      .select({ id: centres.city_id })
      .from(centres)
      .where(eq(centres.state_id, actor.state_id));
    const cityIds = [...new Set(cityRows.map((r) => r.id).filter(Boolean))] as string[];
    if (cityIds.length === 0) {
      ok(res, { items: [] }, { count: 0 });
      return;
    }
    conditions.push(inArray(gallery_items.city_id, cityIds));
  }
  // super_admin: unrestricted

  if (cursor && !Number.isNaN(cursor.getTime())) {
    conditions.push(gt(gallery_items.created_at, cursor));
  }

  const rows = await db
    .select({
      id: gallery_items.id,
      student_id: gallery_items.student_id,
      full_name: students.full_name,
      age_group: students.age_group,
      centre_name: centres.name,
      niyam_title_en: niyams.title_en,
      niyam_title_hi: niyams.title_hi,
      image_url: gallery_items.image_url,
      thumbnail_url: gallery_items.thumbnail_url,
      featured_gallery: gallery_items.featured_gallery,
      featured_home: gallery_items.featured_home,
      is_public: gallery_items.is_public,
      city_id: gallery_items.city_id,
      created_at: gallery_items.created_at,
      submission_id: gallery_items.submission_id,
      opt_in: owner.gallery_visibility_opt_in,
    })
    .from(gallery_items)
    .leftJoin(students, eq(students.id, gallery_items.student_id))
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .leftJoin(niyams, eq(niyams.id, gallery_items.niyam_id))
    .leftJoin(owner, eq(owner.id, sql`coalesce(${students.parent_id}, ${students.user_id})`))
    .where(and(...conditions))
    .orderBy(asc(gallery_items.created_at), asc(gallery_items.id))
    .limit(limit);

  const items = rows.map((r) => ({
    id: r.id,
    student_id: r.student_id,
    first_name: r.student_id ? firstName(r.full_name) : "",
    age_group: r.age_group ?? "",
    centre_name: r.centre_name ?? null,
    niyam_title_en: r.niyam_title_en ?? null,
    niyam_title_hi: r.niyam_title_hi ?? null,
    image_url: signUploadUrl(r.image_url),
    thumbnail_url: signUploadUrl(r.thumbnail_url ?? r.image_url),
    featured_gallery: r.featured_gallery,
    featured_home: r.featured_home,
    is_public: r.is_public,
    city_id: r.city_id,
    submitted_at: r.created_at.toISOString(),
    // Explicit so admins see why featuring would not publish.
    consent_opt_in: r.student_id ? Boolean(r.opt_in) : null,
    can_publish: r.student_id == null || Boolean(r.opt_in),
  }));

  const nextCursor =
    items.length > 0 ? items[items.length - 1]!.submitted_at : null;
  ok(res, { items }, { count: items.length, next_cursor: nextCursor });
});

/* DELETE /v1/gallery/admin/:id — soft-delete takedown (scoped) */
router.delete("/admin/:id", requireAuth, requireAdminPanel, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Gallery item not found.");
    return;
  }
  const item = await loadScopedItem(req, id);
  if (!item) {
    fail(res, 404, "ERR_NOT_FOUND", "Gallery item not found.");
    return;
  }

  const [row] = await db
    .update(gallery_items)
    .set({
      deleted_at: new Date(),
      is_public: false,
      featured_gallery: false,
      featured_home: false,
      featured_at: null,
      featured_by: null,
      updated_at: new Date(),
    })
    .where(and(eq(gallery_items.id, id), isNull(gallery_items.deleted_at)))
    .returning({ id: gallery_items.id });
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "Gallery item not found.");
    return;
  }

  for (const url of [item.image_url, item.thumbnail_url]) {
    if (!url) continue;
    const key = uploadKeyFromUrl(url);
    if (key) await storage.remove(key);
  }

  await auditFromReq(req, {
    action: "delete",
    entityKind: "gallery_item",
    entityId: id,
    summary: "Took down a gallery item.",
  });

  ok(res, { id: row.id, deleted: true });
});

export default router;
