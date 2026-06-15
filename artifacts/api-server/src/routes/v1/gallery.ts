/**
 * /v1/gallery — public gallery + admin management.
 *
 * Public (anonymous):
 *  - GET / — published items. Student-tied media is only ever returned when the
 *    owning user (parent_id, else student.user_id) has opted in to gallery
 *    visibility (users.gallery_visibility_opt_in). Non-student media (student_id
 *    null) is always allowed. This is the minors-privacy consent gate.
 *
 * Admin panel (requireAuth + requireAdminPanel, centre-scoped via
 * resolveAdminScope):
 *  - POST /admin — create an item from an already-uploaded media URL
 *    (folder "gallery"); may attach a student (must be in scope) + niyam.
 *  - GET /admin — list items in scope (includes hidden + non-opted-in, with a
 *    consent flag so admins see why something isn't public).
 *  - PATCH /admin/:id/visibility — toggle is_public / is_featured.
 *  - DELETE /admin/:id — soft-delete takedown; best-effort removes the stored
 *    media object.
 *
 * Scope: a student-tied item belongs to that student's centre; non-student
 * items are global (only super_admin / state / city see/manage them broadly —
 * see listing rules below). Mutations are audited.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, gallery_items, students, niyams, users, centres } from "@workspace/db";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { httpUrl } from "../../lib/validation";
import { signUploadUrl, uploadKeyFromUrl } from "../../lib/file-tokens";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, type AdminScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import { storage } from "../../lib/storage";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---- local helpers copy-pasted into every admin route file ---- */
function inScope(scope: AdminScope, centreId: string | null): boolean {
  if (scope.centreIds === null) return true;
  if (!centreId) return false;
  return scope.centreIds.includes(centreId);
}
function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function firstName(full: string | null): string {
  if (!full) return "—";
  return full.trim().split(/\s+/)[0] ?? full;
}

/* ═══════════════════════════════ Public ═══════════════════════════════ */

/* GET /v1/gallery?limit= — published gallery, consent-gated for student media */
router.get("/", async (req: Request, res: Response) => {
  const limit = clampLimit(req.query.limit, 60, 200);

  // The owning user is the student's parent, or the student's own user when no
  // parent. Consent is that user's gallery_visibility_opt_in. Resolve it with a
  // correlated COALESCE so a single query covers both cases.
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
      is_featured: gallery_items.is_featured,
      created_at: gallery_items.created_at,
      opt_in: owner.gallery_visibility_opt_in,
    })
    .from(gallery_items)
    .leftJoin(students, eq(students.id, gallery_items.student_id))
    .leftJoin(niyams, eq(niyams.id, gallery_items.niyam_id))
    // Owning user = parent_id if present, else the student's own user_id.
    .leftJoin(owner, eq(owner.id, sql`coalesce(${students.parent_id}, ${students.user_id})`))
    .where(
      and(
        eq(gallery_items.is_public, true),
        isNull(gallery_items.deleted_at),
        // Must carry a real image.
        sql`${gallery_items.image_url} is not null`,
        // Consent gate: either non-student media (student_id null) OR the owning
        // user has opted in. A student row whose owner is unresolved/!opted-in
        // is excluded.
        or(
          isNull(gallery_items.student_id),
          eq(owner.gallery_visibility_opt_in, true),
        ),
      ),
    )
    .orderBy(desc(gallery_items.is_featured), desc(gallery_items.created_at))
    .limit(limit);

  const items = rows.map((r) => ({
    id: r.id,
    // Only expose a first name for student media; non-student media has none.
    first_name: r.student_id ? firstName(r.full_name) : "",
    age_group: r.age_group ?? "",
    niyam_title_en: r.niyam_title_en ?? "",
    niyam_title_hi: r.niyam_title_hi ?? "",
    niyam_type: r.niyam_type ?? "",
    image_url: signUploadUrl(r.image_url),
    thumbnail_url: signUploadUrl(r.thumbnail_url ?? r.image_url),
    caption: r.caption ?? null,
    caption_hi: r.caption_hi ?? null,
    is_featured: r.is_featured,
    created_at: r.created_at.toISOString(),
  }));
  ok(res, { items }, { count: items.length });
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
  is_featured: z.boolean().optional(),
});

/* POST /v1/gallery/admin — create an item from an uploaded media URL (scoped) */
router.post("/admin", requireAuth, requireAdminPanel, async (req: Request, res: Response) => {
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid gallery item data.");
    return;
  }

  // Reject media URLs that aren't ours (must come from /v1/uploads → gallery
  // folder); prevents linking arbitrary external/host content into the gallery.
  if (uploadKeyFromUrl(body.image_url) === null) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "image_url must be an uploaded file URL.");
    return;
  }

  const scope = await resolveAdminScope(req.authUser!);

  // Student-tied media: the student must exist and be in the caller's scope.
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
  } else if (scope.centreIds !== null && scope.centreIds.length === 0) {
    // Non-student (global) media can only be created by broad admins. A user
    // with an empty centre scope and no student attachment has nothing to act on.
    fail(res, 403, "ERR_FORBIDDEN", "You cannot publish non-student media.");
    return;
  }

  // A niyam reference is only meaningful for student media.
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
      image_url: body.image_url,
      thumbnail_url: body.thumbnail_url ?? null,
      caption: body.caption ?? null,
      caption_hi: body.caption_hi ?? null,
      is_public: body.is_public ?? true,
      is_featured: body.is_featured ?? false,
      created_by: req.authUser!.id,
    })
    .returning({
      id: gallery_items.id,
      is_public: gallery_items.is_public,
      is_featured: gallery_items.is_featured,
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

  ok(res, { id: row.id, is_public: row.is_public, is_featured: row.is_featured }, undefined, 201);
});

/* GET /v1/gallery/admin?limit= — admin listing (incl. hidden + non-opted-in) */
router.get("/admin", requireAuth, requireAdminPanel, async (req: Request, res: Response) => {
  const limit = clampLimit(req.query.limit, 100, 500);
  const scope = await resolveAdminScope(req.authUser!);

  const owner = users;
  // Scope rule for the listing: rows whose student's centre is in scope, OR
  // non-student (global) rows. super_admin (centreIds null) sees everything.
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
      is_featured: gallery_items.is_featured,
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
    is_featured: r.is_featured,
    is_public: r.is_public,
    // Whether this row's owner has consented (null for non-student media). The
    // UI shows a "consent pending" badge when a student row is not opted in.
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
  // Non-student media: only broad admins (non-empty/null scope) may manage.
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

const visibilitySchema = z
  .object({
    is_public: z.boolean().optional(),
    is_featured: z.boolean().optional(),
  })
  .refine((v) => v.is_public !== undefined || v.is_featured !== undefined, {
    message: "Provide is_public and/or is_featured.",
  });

/* PATCH /v1/gallery/admin/:id/visibility — toggle is_public / is_featured */
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
      fail(res, 422, "ERR_VALIDATION_FAILED", "Provide is_public and/or is_featured.");
      return;
    }
    const item = await loadScopedItem(req, id);
    if (!item) {
      fail(res, 404, "ERR_NOT_FOUND", "Gallery item not found.");
      return;
    }

    const set: Record<string, unknown> = { updated_at: new Date() };
    if (body.is_public !== undefined) set.is_public = body.is_public;
    if (body.is_featured !== undefined) set.is_featured = body.is_featured;

    const [row] = await db
      .update(gallery_items)
      .set(set)
      .where(and(eq(gallery_items.id, id), isNull(gallery_items.deleted_at)))
      .returning({
        id: gallery_items.id,
        is_public: gallery_items.is_public,
        is_featured: gallery_items.is_featured,
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
      metadata: { is_public: row.is_public, is_featured: row.is_featured },
    });

    ok(res, { id: row.id, is_public: row.is_public, is_featured: row.is_featured });
  },
);

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
    .set({ deleted_at: new Date(), is_public: false, is_featured: false, updated_at: new Date() })
    .where(and(eq(gallery_items.id, id), isNull(gallery_items.deleted_at)))
    .returning({ id: gallery_items.id });
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "Gallery item not found.");
    return;
  }

  // Best-effort: remove the stored media so a taken-down image leaves no orphan.
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
