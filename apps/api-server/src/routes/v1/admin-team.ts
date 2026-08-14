/**
 * /v1/admin/team — Team directory admin API.
 *
 * Categories: read + update only (seeded; no create/delete).
 * Members: CRUD, reorder, publish, unpublish.
 *
 * Publish authority is enforced in team-admin service (not role middleware alone).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  db,
  users,
  team_categories,
  team_members,
} from "@workspace/db";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { ok, fail } from "../../lib/envelope";
import { signUploadUrl } from "../../lib/file-tokens";
import { auditFromReq } from "../../lib/audit";
import { zodDetails } from "../../lib/panchang-schema";
import {
  dummyTeamPhotoUrl,
  isScenicPlaceholderUrl,
} from "../../lib/team-public";
import {
  TeamAdminError,
  assertNoDuplicateTeamUser,
  assertTeamPublishAuthority,
  canReadTeamMember,
  getActiveTeamMember,
  getTeamCategory,
  hydrateTeamScope,
  listTeamCategories,
  publishTeamMember,
  reorderTeamMembers,
  resolveTeamPhotoUrls,
  unpublishTeamMember,
  type TeamScopeLevel,
} from "../../lib/team-admin";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const scopeLevelSchema = z.enum(["national", "state", "city", "centre"]);
const displayStyleSchema = z.enum(["featured", "grid", "list"]);
const groupBySchema = z.enum(["none", "centre"]);

const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1) });

const categoryPatchSchema = z
  .object({
    name_en: z.string().min(1).max(200).optional(),
    name_hi: z.string().min(1).max(200).optional(),
    order: z.number().int().optional(),
    display_style: displayStyleSchema.optional(),
    group_by: groupBySchema.optional(),
    is_lazy_loaded: z.boolean().optional(),
    is_published: z.boolean().optional(),
  })
  .strict();

const memberCreateSchema = z
  .object({
    category_id: z.string().uuid(),
    user_id: z.string().uuid().nullable().optional(),
    scope_level: scopeLevelSchema,
    state_id: z.string().uuid().nullable().optional(),
    city_id: z.string().uuid().nullable().optional(),
    centre_id: z.string().uuid().nullable().optional(),
    honorific: z.string().max(80).nullable().optional(),
    display_name_en: z.string().min(1).max(200).nullable().optional(),
    display_name_hi: z.string().max(200).nullable().optional(),
    designation_en: z.string().max(200).nullable().optional(),
    designation_hi: z.string().max(200).nullable().optional(),
    bio_en: z.string().max(4000).nullable().optional(),
    bio_hi: z.string().max(4000).nullable().optional(),
    photo_override_asset_id: z.string().uuid().nullable().optional(),
    associated_since: z.number().int().min(1900).max(2100).nullable().optional(),
    is_in_memoriam: z.boolean().optional(),
    order: z.number().int().optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (!b.user_id && !b.display_name_en?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "display_name_en is required when user_id is null (manual / trustee cards).",
        path: ["display_name_en"],
      });
    }
  });

const memberPatchSchema = z
  .object({
    category_id: z.string().uuid().optional(),
    user_id: z.string().uuid().nullable().optional(),
    scope_level: scopeLevelSchema.optional(),
    state_id: z.string().uuid().nullable().optional(),
    city_id: z.string().uuid().nullable().optional(),
    centre_id: z.string().uuid().nullable().optional(),
    honorific: z.string().max(80).nullable().optional(),
    display_name_en: z.string().min(1).max(200).nullable().optional(),
    display_name_hi: z.string().max(200).nullable().optional(),
    designation_en: z.string().max(200).nullable().optional(),
    designation_hi: z.string().max(200).nullable().optional(),
    bio_en: z.string().max(4000).nullable().optional(),
    bio_hi: z.string().max(4000).nullable().optional(),
    photo_override_asset_id: z.string().uuid().nullable().optional(),
    associated_since: z.number().int().min(1900).max(2100).nullable().optional(),
    is_in_memoriam: z.boolean().optional(),
    order: z.number().int().optional(),
  })
  .strict();

function failTeam(res: Response, err: unknown): boolean {
  if (err instanceof TeamAdminError) {
    fail(res, err.status, err.code, err.message);
    return true;
  }
  return false;
}

function mapCategory(row: typeof team_categories.$inferSelect) {
  return {
    id: row.id,
    key: row.key,
    name_en: row.name_en,
    name_hi: row.name_hi,
    order: row.order,
    display_style: row.display_style,
    group_by: row.group_by,
    is_lazy_loaded: row.is_lazy_loaded,
    is_published: row.is_published,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

async function mapMember(
  row: typeof team_members.$inferSelect,
  photoUrls?: Map<string, string>,
) {
  let user: { id: string; full_name: string; role: string; photo_url: string | null } | null = null;
  if (row.user_id) {
    const [u] = await db
      .select({
        id: users.id,
        full_name: users.full_name,
        role: users.role,
        photo_url: users.photo_url,
      })
      .from(users)
      .where(eq(users.id, row.user_id))
      .limit(1);
    user = u ?? null;
  }

  const overrideUrl = row.photo_override_asset_id
    ? photoUrls?.get(row.photo_override_asset_id) ?? null
    : null;

  return {
    id: row.id,
    category_id: row.category_id,
    user_id: row.user_id,
    user,
    scope_level: row.scope_level,
    state_id: row.state_id,
    city_id: row.city_id,
    centre_id: row.centre_id,
    honorific: row.honorific,
    display_name_en: row.display_name_en,
    display_name_hi: row.display_name_hi,
    designation_en: row.designation_en,
    designation_hi: row.designation_hi,
    bio_en: row.bio_en,
    bio_hi: row.bio_hi,
    photo_override_asset_id: row.photo_override_asset_id,
    photo_url: (() => {
      const stored = overrideUrl ?? user?.photo_url ?? null;
      return isScenicPlaceholderUrl(stored)
        ? dummyTeamPhotoUrl(row.id)
        : signUploadUrl(stored);
    })(),
    associated_since: row.associated_since,
    is_in_memoriam: row.is_in_memoriam,
    order: row.order,
    is_published: row.is_published,
    published_at: row.published_at?.toISOString() ?? null,
    unpublished_by: row.unpublished_by,
    content_version: row.content_version,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/* ── Categories (read + update; seeded — no create/delete) ─────────────── */

router.get("/categories", async (_req: Request, res: Response) => {
  const rows = await listTeamCategories();
  ok(res, { items: rows.map(mapCategory) });
});

router.get("/categories/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "That Team category could not be found.");
    return;
  }
  const row = await getTeamCategory(id);
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That Team category could not be found.");
    return;
  }
  ok(res, { category: mapCategory(row) });
});

router.patch("/categories/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "That Team category could not be found.");
    return;
  }
  const parsed = categoryPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid category payload.", zodDetails(parsed.error));
    return;
  }

  // Category publish/settings: same authority gate as members (city_admin+ via service).
  // Categories are national config — only super_admin / state_admin may change them.
  try {
    assertTeamPublishAuthority(req.authUser!, {
      scope_level: "national",
      state_id: null,
      city_id: null,
      centre_id: null,
    });
  } catch (err) {
    if (failTeam(res, err)) return;
    throw err;
  }

  const b = parsed.data;
  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (b.name_en !== undefined) patch.name_en = b.name_en;
  if (b.name_hi !== undefined) patch.name_hi = b.name_hi;
  if (b.order !== undefined) patch.order = b.order;
  if (b.display_style !== undefined) patch.display_style = b.display_style;
  if (b.group_by !== undefined) patch.group_by = b.group_by;
  if (b.is_lazy_loaded !== undefined) patch.is_lazy_loaded = b.is_lazy_loaded;
  if (b.is_published !== undefined) patch.is_published = b.is_published;

  const [row] = await db
    .update(team_categories)
    .set(patch)
    .where(eq(team_categories.id, id))
    .returning();
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That Team category could not be found.");
    return;
  }

  await auditFromReq(req, {
    action: "update",
    entityKind: "team_category",
    entityId: id,
    summary: "Team category updated.",
    metadata: b,
  });
  ok(res, { category: mapCategory(row) });
});

/* ── Members ─────────────────────────────────────────────────────────────── */

router.get("/members", async (req: Request, res: Response) => {
  const actor = req.authUser!;
  const categoryId = typeof req.query.category_id === "string" ? req.query.category_id : null;
  const cityId = typeof req.query.city_id === "string" ? req.query.city_id : null;
  const centreId = typeof req.query.centre_id === "string" ? req.query.centre_id : null;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const published =
    req.query.is_published === "true" ? true : req.query.is_published === "false" ? false : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const conditions = [isNull(team_members.deleted_at)];
  if (categoryId && UUID_RE.test(categoryId)) conditions.push(eq(team_members.category_id, categoryId));
  if (cityId && UUID_RE.test(cityId)) conditions.push(eq(team_members.city_id, cityId));
  if (centreId && UUID_RE.test(centreId)) conditions.push(eq(team_members.centre_id, centreId));
  if (published !== null) conditions.push(eq(team_members.is_published, published));
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, "")}%`;
    conditions.push(
      sql`(
        coalesce(${team_members.display_name_en}, '') ILIKE ${like}
        OR coalesce(${team_members.display_name_hi}, '') ILIKE ${like}
        OR EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = ${team_members.user_id}
            AND coalesce(u.full_name, '') ILIKE ${like}
        )
      )`,
    );
  }

  // city_admin: hard-filter to their city (national/state rows without city stay hidden).
  if (actor.role === "city_admin") {
    if (!actor.city_id) {
      ok(res, { items: [] }, { total: 0, limit, offset });
      return;
    }
    conditions.push(eq(team_members.city_id, actor.city_id));
  } else if (actor.role === "sanchalak" || actor.role === "shikshak") {
    // Service-layer denial for roles without Team management rights.
    fail(
      res,
      403,
      "ERR_TEAM_PUBLISH_FORBIDDEN",
      "You cannot manage Team members outside your scope — ask a city or state admin.",
    );
    return;
  }

  const where = and(...conditions);
  const [totalRow] = await db.select({ n: count() }).from(team_members).where(where);
  const rows = await db
    .select()
    .from(team_members)
    .where(where)
    .orderBy(asc(team_members.order), asc(team_members.created_at))
    .limit(limit)
    .offset(offset);

  const photoUrls = await resolveTeamPhotoUrls(rows.map((r) => r.photo_override_asset_id));
  const items = [];
  for (const row of rows) {
    if (
      !canReadTeamMember(actor, {
        scope_level: row.scope_level as TeamScopeLevel,
        state_id: row.state_id,
        city_id: row.city_id,
        centre_id: row.centre_id,
      })
    ) {
      continue;
    }
    items.push(await mapMember(row, photoUrls));
  }

  ok(res, { items }, { total: Number(totalRow?.n ?? 0), limit, offset });
});

router.get("/members/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "That Team member could not be found.");
    return;
  }
  const row = await getActiveTeamMember(id);
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That Team member could not be found.");
    return;
  }
  try {
    assertTeamPublishAuthority(req.authUser!, {
      scope_level: row.scope_level as TeamScopeLevel,
      state_id: row.state_id,
      city_id: row.city_id,
      centre_id: row.centre_id,
    });
  } catch (err) {
    if (failTeam(res, err)) return;
    throw err;
  }
  const photoUrls = await resolveTeamPhotoUrls([row.photo_override_asset_id]);
  ok(res, { member: await mapMember(row, photoUrls) });
});

router.post("/members", async (req: Request, res: Response) => {
  const parsed = memberCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid Team member payload.", zodDetails(parsed.error));
    return;
  }
  const b = parsed.data;
  const cat = await getTeamCategory(b.category_id);
  if (!cat) {
    fail(res, 404, "ERR_NOT_FOUND", "That Team category could not be found.");
    return;
  }

  try {
    const scope = await hydrateTeamScope({
      scope_level: b.scope_level,
      state_id: b.state_id,
      city_id: b.city_id,
      centre_id: b.centre_id,
    });
    assertTeamPublishAuthority(req.authUser!, scope);

    const userId = b.user_id ?? null;
    if (userId) await assertNoDuplicateTeamUser(userId);

    const [row] = await db
      .insert(team_members)
      .values({
        category_id: b.category_id,
        user_id: userId,
        scope_level: scope.scope_level,
        state_id: scope.state_id,
        city_id: scope.city_id,
        centre_id: scope.centre_id,
        honorific: b.honorific ?? null,
        display_name_en: b.display_name_en?.trim() || null,
        display_name_hi: b.display_name_hi?.trim() || null,
        designation_en: b.designation_en?.trim() || null,
        designation_hi: b.designation_hi?.trim() || null,
        bio_en: b.bio_en ?? null,
        bio_hi: b.bio_hi ?? null,
        photo_override_asset_id: b.photo_override_asset_id ?? null,
        associated_since: b.associated_since ?? null,
        is_in_memoriam: b.is_in_memoriam ?? false,
        order: b.order ?? 0,
        is_published: false,
        content_version: 1,
      })
      .returning();

    await auditFromReq(req, {
      action: "create",
      entityKind: "team_member",
      entityId: row!.id,
      summary: "Team member created.",
      metadata: { user_id: userId, scope_level: scope.scope_level },
    });

    const photoUrls = await resolveTeamPhotoUrls([row!.photo_override_asset_id]);
    ok(res, { member: await mapMember(row!, photoUrls) }, undefined, 201);
  } catch (err) {
    if (failTeam(res, err)) return;
    // Unique partial index race
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      fail(
        res,
        409,
        "ERR_TEAM_MEMBER_DUPLICATE",
        "That user already has a Team card — edit the existing row instead of creating another.",
      );
      return;
    }
    throw err;
  }
});

router.patch("/members/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "That Team member could not be found.");
    return;
  }
  const parsed = memberPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid Team member payload.", zodDetails(parsed.error));
    return;
  }

  const existing = await getActiveTeamMember(id);
  if (!existing) {
    fail(res, 404, "ERR_NOT_FOUND", "That Team member could not be found.");
    return;
  }

  try {
    assertTeamPublishAuthority(req.authUser!, {
      scope_level: existing.scope_level as TeamScopeLevel,
      state_id: existing.state_id,
      city_id: existing.city_id,
      centre_id: existing.centre_id,
    });

    const b = parsed.data;
    if (b.category_id) {
      const cat = await getTeamCategory(b.category_id);
      if (!cat) {
        fail(res, 404, "ERR_NOT_FOUND", "That Team category could not be found.");
        return;
      }
    }

    const nextUserId = b.user_id !== undefined ? b.user_id : existing.user_id;
    const nextDisplayEn =
      b.display_name_en !== undefined ? b.display_name_en?.trim() || null : existing.display_name_en;
    if (!nextUserId && !nextDisplayEn) {
      fail(
        res,
        422,
        "ERR_VALIDATION_FAILED",
        "display_name_en is required when user_id is null (manual / trustee cards).",
      );
      return;
    }
    if (nextUserId && nextUserId !== existing.user_id) {
      await assertNoDuplicateTeamUser(nextUserId, id);
    }

    const scope = await hydrateTeamScope({
      scope_level: (b.scope_level ?? existing.scope_level) as TeamScopeLevel,
      state_id: b.state_id !== undefined ? b.state_id : existing.state_id,
      city_id: b.city_id !== undefined ? b.city_id : existing.city_id,
      centre_id: b.centre_id !== undefined ? b.centre_id : existing.centre_id,
    });
    assertTeamPublishAuthority(req.authUser!, scope);

    const [row] = await db
      .update(team_members)
      .set({
        category_id: b.category_id ?? existing.category_id,
        user_id: nextUserId,
        scope_level: scope.scope_level,
        state_id: scope.state_id,
        city_id: scope.city_id,
        centre_id: scope.centre_id,
        honorific: b.honorific !== undefined ? b.honorific : existing.honorific,
        display_name_en: nextDisplayEn,
        display_name_hi:
          b.display_name_hi !== undefined ? b.display_name_hi?.trim() || null : existing.display_name_hi,
        designation_en:
          b.designation_en !== undefined ? b.designation_en?.trim() || null : existing.designation_en,
        designation_hi:
          b.designation_hi !== undefined ? b.designation_hi?.trim() || null : existing.designation_hi,
        bio_en: b.bio_en !== undefined ? b.bio_en : existing.bio_en,
        bio_hi: b.bio_hi !== undefined ? b.bio_hi : existing.bio_hi,
        photo_override_asset_id:
          b.photo_override_asset_id !== undefined
            ? b.photo_override_asset_id
            : existing.photo_override_asset_id,
        associated_since:
          b.associated_since !== undefined ? b.associated_since : existing.associated_since,
        is_in_memoriam: b.is_in_memoriam ?? existing.is_in_memoriam,
        order: b.order ?? existing.order,
        content_version: existing.content_version + 1,
        updated_at: new Date(),
      })
      .where(eq(team_members.id, id))
      .returning();

    await auditFromReq(req, {
      action: "update",
      entityKind: "team_member",
      entityId: id,
      summary: "Team member updated.",
      metadata: b,
    });

    const photoUrls = await resolveTeamPhotoUrls([row!.photo_override_asset_id]);
    ok(res, { member: await mapMember(row!, photoUrls) });
  } catch (err) {
    if (failTeam(res, err)) return;
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      fail(
        res,
        409,
        "ERR_TEAM_MEMBER_DUPLICATE",
        "That user already has a Team card — edit the existing row instead of creating another.",
      );
      return;
    }
    throw err;
  }
});

router.delete("/members/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "That Team member could not be found.");
    return;
  }
  const existing = await getActiveTeamMember(id);
  if (!existing) {
    fail(res, 404, "ERR_NOT_FOUND", "That Team member could not be found.");
    return;
  }
  try {
    assertTeamPublishAuthority(req.authUser!, {
      scope_level: existing.scope_level as TeamScopeLevel,
      state_id: existing.state_id,
      city_id: existing.city_id,
      centre_id: existing.centre_id,
    });
  } catch (err) {
    if (failTeam(res, err)) return;
    throw err;
  }

  const now = new Date();
  await db
    .update(team_members)
    .set({
      deleted_at: now,
      is_published: false,
      unpublished_by: req.authUser!.id,
      content_version: existing.content_version + 1,
      updated_at: now,
    })
    .where(eq(team_members.id, id));

  await auditFromReq(req, {
    action: "delete",
    entityKind: "team_member",
    entityId: id,
    summary: "Team member soft-deleted.",
  });
  ok(res, { deleted: true });
});

router.post("/members/reorder", async (req: Request, res: Response) => {
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "ids must be a non-empty UUID array.", zodDetails(parsed.error));
    return;
  }
  try {
    const n = await reorderTeamMembers(parsed.data.ids, req.authUser!);
    await auditFromReq(req, {
      action: "update",
      entityKind: "team_member",
      summary: "Team members reordered.",
      metadata: { ids: parsed.data.ids },
    });
    ok(res, { reordered: n });
  } catch (err) {
    if (failTeam(res, err)) return;
    throw err;
  }
});

router.post("/members/:id/publish", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "That Team member could not be found.");
    return;
  }
  try {
    const row = await publishTeamMember(id, req.authUser!);
    await auditFromReq(req, {
      action: "update",
      entityKind: "team_member",
      entityId: id,
      summary: "Team member published.",
      metadata: { content_version: row.content_version },
    });
    const photoUrls = await resolveTeamPhotoUrls([row.photo_override_asset_id]);
    ok(res, { member: await mapMember(row, photoUrls) });
  } catch (err) {
    if (failTeam(res, err)) return;
    throw err;
  }
});

router.post("/members/:id/unpublish", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "That Team member could not be found.");
    return;
  }
  try {
    const row = await unpublishTeamMember(id, req.authUser!);
    await auditFromReq(req, {
      action: "update",
      entityKind: "team_member",
      entityId: id,
      summary: "Team member unpublished (sticky unpublished_by).",
      metadata: { content_version: row.content_version, unpublished_by: row.unpublished_by },
    });
    const photoUrls = await resolveTeamPhotoUrls([row.photo_override_asset_id]);
    ok(res, { member: await mapMember(row, photoUrls) });
  } catch (err) {
    if (failTeam(res, err)) return;
    throw err;
  }
});

export default router;
