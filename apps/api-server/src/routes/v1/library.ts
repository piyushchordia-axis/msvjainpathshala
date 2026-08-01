/**
 * /v1/library — the authenticated member + admin surface for the digital
 * library. The PUBLIC read (GET /v1/public/library) stays where it is and only
 * ever exposes `access_tier='public'` items WITHOUT delivery URLs; this router
 * adds the two surfaces that were missing:
 *
 *  - MEMBER feed (GET /v1/library) — any authenticated user. Returns every
 *    published item the caller's tier allows (always `public`, plus the tiers
 *    they qualify for) and, crucially, INCLUDES the delivery URL (`file_url`
 *    for stored files, `embed_url` for hosted media) so content is actually
 *    deliverable. A `library_access_logs` row is written when an item's URL is
 *    handed out (idempotent per user+item+url via the POST /:id/access tracker
 *    that the clients call when a resource is opened).
 *
 *  - ADMIN authoring (POST / PATCH / DELETE) — admin-panel roles only. The
 *    library is a NETWORK-WIDE resource (library_items has no centre/city
 *    column), so only super_admin may mutate it; every other admin-panel role
 *    is read-allowed on the admin list but blocked from writes. Mutations are
 *    audited. resolveAdminScope is consulted so the gate stays consistent with
 *    the rest of the admin surface.
 *
 * Access-tier model (who can see which tier):
 *   public   → everyone (incl. the public route)
 *   student  → any caller who owns a student record (parent of, or is, a student)
 *   msv      → any caller who owns a student whose msv_status = 'approved'
 *   shikshak → callers whose role is shikshak (teachers) or any admin-panel role
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, library_items, library_access_logs, students, type User } from "@workspace/db";
import { LIBRARY_ACCESS_TIERS, LIBRARY_CONTENT_TYPES } from "@workspace/db/enums";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { canAccessAdminPanel } from "@workspace/api-zod";
import { auditFromReq } from "../../lib/audit";
import { httpUrl } from "../../lib/validation";
import { clampLimit } from "../../lib/route-helpers";

const router: IRouter = Router();
router.use(requireAuth);

type AccessTier = (typeof LIBRARY_ACCESS_TIERS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/**
 * The set of access tiers a caller is allowed to read. `public` is always
 * included. The remaining tiers are unlocked by what the caller is/owns.
 */
async function tiersForUser(user: User): Promise<AccessTier[]> {
  const tiers = new Set<AccessTier>(["public"]);

  // Teachers and admin-panel roles get the full set (they may need every tier
  // to curate/preview). canAccessAdminPanel covers shikshak + admin roles.
  if (canAccessAdminPanel(user.role)) {
    tiers.add("student");
    tiers.add("msv");
    tiers.add("shikshak");
    return Array.from(tiers);
  }

  // Otherwise resolve from the student records the caller owns (parent: their
  // children; student: self). Any owned student → student tier; an approved
  // MSV student → msv tier as well.
  const owned = await db
    .select({ msv_status: students.msv_status })
    .from(students)
    .where(
      and(
        sql`${students.deleted_at} is null`,
        or(eq(students.parent_id, user.id), eq(students.user_id, user.id)),
      ),
    );

  if (owned.length > 0) {
    tiers.add("student");
    if (owned.some((s) => s.msv_status === "approved")) tiers.add("msv");
  }

  return Array.from(tiers);
}

/** Pick the deliverable URL for an item (stored file first, then hosted embed). */
function deliveryUrl(item: { file_url: string | null; embed_url: string | null }): string | null {
  return item.file_url ?? item.embed_url ?? null;
}

/* ═══════════════════════════════ MEMBER feed ═══════════════════════════════ */

/* GET /v1/library?limit=&content_type=&tier=
   Published items the caller's tier allows, INCLUDING delivery URLs. */
router.get("/", async (req: Request, res: Response) => {
  const limit = clampLimit(req.query.limit, 60, 200);
  const allowed = await tiersForUser(req.authUser!);

  // Optional filters (validated against the allowed set / enum).
  const tierFilter = req.query.tier;
  let tiers = allowed;
  if (typeof tierFilter === "string" && (LIBRARY_ACCESS_TIERS as readonly string[]).includes(tierFilter)) {
    tiers = allowed.includes(tierFilter as AccessTier) ? [tierFilter as AccessTier] : [];
  }
  if (tiers.length === 0) {
    ok(res, { items: [], tiers: allowed }, { count: 0 });
    return;
  }

  const conds = [eq(library_items.is_published, true), inArray(library_items.access_tier, tiers)];
  const ct = req.query.content_type;
  if (typeof ct === "string" && (LIBRARY_CONTENT_TYPES as readonly string[]).includes(ct)) {
    conds.push(eq(library_items.content_type, ct as (typeof LIBRARY_CONTENT_TYPES)[number]));
  }

  const rows = await db
    .select({
      id: library_items.id,
      content_type: library_items.content_type,
      title_en: library_items.title_en,
      title_hi: library_items.title_hi,
      description_en: library_items.description_en,
      description_hi: library_items.description_hi,
      embed_url: library_items.embed_url,
      file_url: library_items.file_url,
      access_tier: library_items.access_tier,
      created_at: library_items.created_at,
    })
    .from(library_items)
    .where(and(...conds))
    .orderBy(desc(library_items.created_at))
    .limit(limit);

  const items = rows.map((r) => ({
    id: r.id,
    content_type: r.content_type,
    title_en: r.title_en,
    title_hi: r.title_hi,
    description_en: r.description_en,
    description_hi: r.description_hi,
    embed_url: r.embed_url,
    file_url: r.file_url,
    // Single field the clients render an open/play/download action from.
    url: deliveryUrl(r),
    access_tier: r.access_tier,
    created_at: r.created_at.toISOString(),
  }));

  ok(res, { items, tiers: allowed }, { count: items.length });
});

/* POST /v1/library/:id/access — record an access in library_access_logs.
   Called by the clients when a member actually opens/plays/downloads an item.
   Returns the delivery URL again so a single round-trip both logs + delivers. */
router.post("/:id/access", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Library item not found.");
    return;
  }

  const allowed = await tiersForUser(req.authUser!);
  const [item] = await db
    .select({
      id: library_items.id,
      content_type: library_items.content_type,
      file_url: library_items.file_url,
      embed_url: library_items.embed_url,
      access_tier: library_items.access_tier,
      is_published: library_items.is_published,
    })
    .from(library_items)
    .where(eq(library_items.id, id))
    .limit(1);

  // 404 (not 403) when the item exists but is out of the caller's tier, so the
  // tiering is not enumerable by probing.
  if (!item || !item.is_published || !allowed.includes(item.access_tier as AccessTier)) {
    fail(res, 404, "ERR_NOT_FOUND", "Library item not found.");
    return;
  }

  const url = deliveryUrl(item);
  if (!url) {
    fail(res, 409, "ERR_NO_CONTENT_URL", "This item has no deliverable file or link yet.");
    return;
  }

  // Best-effort log; never block delivery on a logging failure.
  try {
    await db.insert(library_access_logs).values({
      library_item_id: item.id,
      user_id: req.authUser!.id,
    });
  } catch {
    /* ignore — access logging is non-critical */
  }

  ok(res, { id: item.id, content_type: item.content_type, url });
});

/* ═══════════════════════════════ ADMIN authoring ═══════════════════════════ */

// The library is network-wide (no centre/city scoping column), so writes are
// restricted to super_admin. Lower admin roles may still read the admin list.
function isLibraryEditor(user: User): boolean {
  return user.role === "super_admin";
}

const baseFields = {
  content_type: z.enum(LIBRARY_CONTENT_TYPES),
  title_en: z.string().min(1).max(300),
  title_hi: z.string().max(300).optional(),
  description_en: z.string().max(4000).optional(),
  description_hi: z.string().max(4000).optional(),
  embed_url: httpUrl(2000).optional(),
  file_url: httpUrl(2000).optional(),
  access_tier: z.enum(LIBRARY_ACCESS_TIERS).default("public"),
  is_published: z.boolean().default(true),
};

const createSchema = z
  .object(baseFields)
  .refine((v) => !!v.embed_url || !!v.file_url, {
    message: "An embed_url or file_url is required so the item is deliverable.",
  });

/* GET /v1/library/admin?limit=&content_type=&access_tier=
   Full admin list — every item incl. drafts + both URLs. */
router.get("/admin", requireAdminPanel, async (req: Request, res: Response) => {
  const limit = clampLimit(req.query.limit, 100, 300);
  const conds = [];
  const ct = req.query.content_type;
  if (typeof ct === "string" && (LIBRARY_CONTENT_TYPES as readonly string[]).includes(ct)) {
    conds.push(eq(library_items.content_type, ct as (typeof LIBRARY_CONTENT_TYPES)[number]));
  }
  const at = req.query.access_tier;
  if (typeof at === "string" && (LIBRARY_ACCESS_TIERS as readonly string[]).includes(at)) {
    conds.push(eq(library_items.access_tier, at as AccessTier));
  }

  const rows = await db
    .select({
      id: library_items.id,
      content_type: library_items.content_type,
      title_en: library_items.title_en,
      title_hi: library_items.title_hi,
      description_en: library_items.description_en,
      description_hi: library_items.description_hi,
      embed_url: library_items.embed_url,
      file_url: library_items.file_url,
      access_tier: library_items.access_tier,
      is_published: library_items.is_published,
      created_at: library_items.created_at,
      access_count: sql<number>`(
        select count(*)::int from ${library_access_logs}
        where ${library_access_logs.library_item_id} = ${library_items.id}
      )`,
    })
    .from(library_items)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(library_items.created_at))
    .limit(limit);

  const items = rows.map((r) => ({
    ...r,
    url: deliveryUrl(r),
    can_edit: isLibraryEditor(req.authUser!),
    created_at: r.created_at.toISOString(),
  }));
  ok(res, { items, can_edit: isLibraryEditor(req.authUser!) }, { count: items.length });
});

/* POST /v1/library — create a library item (super_admin only). */
router.post("/", requireAdminPanel, async (req: Request, res: Response) => {
  if (!isLibraryEditor(req.authUser!)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only a super admin may manage library items.");
    return;
  }
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid library item data.");
    return;
  }

  const [row] = await db
    .insert(library_items)
    .values({
      content_type: body.content_type,
      title_en: body.title_en,
      title_hi: body.title_hi ?? null,
      description_en: body.description_en ?? null,
      description_hi: body.description_hi ?? null,
      embed_url: body.embed_url ?? null,
      file_url: body.file_url ?? null,
      access_tier: body.access_tier,
      is_published: body.is_published,
    })
    .returning({ id: library_items.id });

  await auditFromReq(req, {
    action: "create",
    entityKind: "library_item",
    entityId: row.id,
    summary: `Created library item ${body.title_en}`,
    metadata: { content_type: body.content_type, access_tier: body.access_tier },
  });

  ok(res, { id: row.id });
});

const updateSchema = z
  .object({
    content_type: z.enum(LIBRARY_CONTENT_TYPES).optional(),
    title_en: z.string().min(1).max(300).optional(),
    title_hi: z.string().max(300).nullable().optional(),
    description_en: z.string().max(4000).nullable().optional(),
    description_hi: z.string().max(4000).nullable().optional(),
    embed_url: httpUrl(2000).nullable().optional(),
    file_url: httpUrl(2000).nullable().optional(),
    access_tier: z.enum(LIBRARY_ACCESS_TIERS).optional(),
    is_published: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update." });

/* PATCH /v1/library/:id — edit a library item (super_admin only). */
router.patch("/:id", requireAdminPanel, async (req: Request, res: Response) => {
  if (!isLibraryEditor(req.authUser!)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only a super admin may manage library items.");
    return;
  }
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Library item not found.");
    return;
  }
  let body: z.infer<typeof updateSchema>;
  try {
    body = updateSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid library item data.");
    return;
  }

  const [existing] = await db
    .select({ id: library_items.id, file_url: library_items.file_url, embed_url: library_items.embed_url })
    .from(library_items)
    .where(eq(library_items.id, id))
    .limit(1);
  if (!existing) {
    fail(res, 404, "ERR_NOT_FOUND", "Library item not found.");
    return;
  }

  // Guard against editing an item into an undeliverable state (no file + no embed).
  const nextFile = body.file_url !== undefined ? body.file_url : existing.file_url;
  const nextEmbed = body.embed_url !== undefined ? body.embed_url : existing.embed_url;
  if (!nextFile && !nextEmbed) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "An item must keep an embed_url or file_url.");
    return;
  }

  const patch: Record<string, unknown> = {};
  if (body.content_type !== undefined) patch.content_type = body.content_type;
  if (body.title_en !== undefined) patch.title_en = body.title_en;
  if (body.title_hi !== undefined) patch.title_hi = body.title_hi;
  if (body.description_en !== undefined) patch.description_en = body.description_en;
  if (body.description_hi !== undefined) patch.description_hi = body.description_hi;
  if (body.embed_url !== undefined) patch.embed_url = body.embed_url;
  if (body.file_url !== undefined) patch.file_url = body.file_url;
  if (body.access_tier !== undefined) patch.access_tier = body.access_tier;
  if (body.is_published !== undefined) patch.is_published = body.is_published;

  await db.update(library_items).set(patch).where(eq(library_items.id, id));

  await auditFromReq(req, {
    action: "update",
    entityKind: "library_item",
    entityId: id,
    summary: `Updated library item`,
    metadata: { fields: Object.keys(patch) },
  });

  ok(res, { id });
});

/* DELETE /v1/library/:id — hard delete (super_admin only). */
router.delete("/:id", requireAdminPanel, async (req: Request, res: Response) => {
  if (!isLibraryEditor(req.authUser!)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only a super admin may manage library items.");
    return;
  }
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Library item not found.");
    return;
  }

  const deleted = await db
    .delete(library_items)
    .where(eq(library_items.id, id))
    .returning({ id: library_items.id, title_en: library_items.title_en });
  if (deleted.length === 0) {
    fail(res, 404, "ERR_NOT_FOUND", "Library item not found.");
    return;
  }

  await auditFromReq(req, {
    action: "delete",
    entityKind: "library_item",
    entityId: id,
    summary: `Deleted library item ${deleted[0].title_en}`,
  });

  ok(res, { id });
});

export default router;
