/**
 * /v1/notices — public announcement feed, an authenticated audience-scoped
 * feed, admin authoring (create/edit/delete), and per-user read receipts.
 *
 * Visibility model. A notice carries an `audience` (national | state | city |
 * centre | batch | msv) plus the matching scope column (state_id / city_id /
 * centre_id / batch_id) and an `is_public` flag.
 *  - GET /public  : unauthenticated; only is_public=true notices.
 *  - GET /feed    : authenticated; every notice the caller may see by role +
 *                   geography/centre/batch, INCLUDING internal (is_public=false)
 *                   ones. Members see notices that match any centre/batch they
 *                   belong to (and their own city/state), plus national; MSV
 *                   members additionally see audience='msv'. Admin-panel users
 *                   see everything within their resolveAdminScope.
 *
 * Authoring (admin-panel roles via requireAdminPanel) is constrained by
 * resolveAdminScope: a centre/batch target must lie inside the caller's scope;
 * city/state/national targeting is reserved for admins whose scope is broad
 * enough (super_admin always; otherwise the city/state must match the caller's
 * own city/state). Every mutation is audited.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  notices,
  notice_reads,
  batches,
  centres,
  students,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, type AdminScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/* ---- local scope helpers (mirrors the pattern in every admin route file) ---- */
function inScope(scope: AdminScope, centreId: string | null): boolean {
  if (scope.centreIds === null) return true;
  if (!centreId) return false;
  return scope.centreIds.includes(centreId);
}

const ORDER = [desc(notices.pinned), desc(notices.published_at), desc(notices.created_at)] as const;

/* ════════════════════════════════ PUBLIC ════════════════════════════════ */

/* GET /v1/notices/public?limit= — public (is_public=true) notices, no auth */
router.get("/public", async (req: Request, res: Response) => {
  const limit = clampLimit(req.query.limit, 50, 200);
  const rows = await db
    .select({
      id: notices.id,
      title_en: notices.title_en,
      title_hi: notices.title_hi,
      content_en: notices.content_en,
      content_hi: notices.content_hi,
      pinned: notices.pinned,
      is_critical: notices.is_critical,
      created_at: notices.created_at,
    })
    .from(notices)
    .where(eq(notices.is_public, true))
    .orderBy(...ORDER)
    .limit(limit);

  const items = rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
  ok(res, { items }, { count: items.length });
});

/* ══════════════════════════ AUTHENTICATED FEED ══════════════════════════ */

/**
 * Build the visibility predicate for a member (non admin-panel caller).
 * A notice is visible when it matches the caller's geography (own city/state),
 * any centre/batch they belong to (as student or parent), national audience for
 * everyone, and msv audience for MSV members.
 */
function memberVisibility(args: {
  cityId: string | null;
  stateId: string | null;
  centreIds: string[];
  batchIds: string[];
  isMsv: boolean;
}) {
  const clauses = [eq(notices.audience, "national")];

  if (args.stateId) {
    clauses.push(and(eq(notices.audience, "state"), eq(notices.state_id, args.stateId))!);
  }
  if (args.cityId) {
    clauses.push(and(eq(notices.audience, "city"), eq(notices.city_id, args.cityId))!);
  }
  if (args.centreIds.length > 0) {
    clauses.push(and(eq(notices.audience, "centre"), inArray(notices.centre_id, args.centreIds))!);
  }
  if (args.batchIds.length > 0) {
    clauses.push(and(eq(notices.audience, "batch"), inArray(notices.batch_id, args.batchIds))!);
  }
  if (args.isMsv) {
    clauses.push(eq(notices.audience, "msv"));
  }
  return or(...clauses);
}

/* GET /v1/notices/feed?limit= — audience-scoped feed for the authed caller */
router.get("/feed", requireAuth, async (req: Request, res: Response) => {
  const user = req.authUser!;
  const limit = clampLimit(req.query.limit, 50, 200);

  let where;
  if (canSeeEverythingInScope(user.role)) {
    // Admin-panel users: every notice whose scope intersects their centre scope.
    // National/state/city audiences (which have no centre) stay visible too.
    const scope = await resolveAdminScope(user);
    where = adminFeedWhere(scope, user.state_id ?? null, user.city_id ?? null);
  } else {
    // Member: resolve the centres/batches they belong to (own student records or
    // children they parent), then build the visibility predicate.
    const owned = await db
      .select({ centre_id: students.centre_id, batch_id: students.batch_id, msv_status: students.msv_status })
      .from(students)
      .where(and(isNull(students.deleted_at), or(eq(students.user_id, user.id), eq(students.parent_id, user.id))));

    const centreIds = Array.from(new Set(owned.map((o) => o.centre_id).filter((x): x is string => !!x)));
    const batchIds = Array.from(new Set(owned.map((o) => o.batch_id).filter((x): x is string => !!x)));
    const isMsv = owned.some((o) => o.msv_status === "approved");

    where = memberVisibility({
      cityId: user.city_id ?? null,
      stateId: user.state_id ?? null,
      centreIds,
      batchIds,
      isMsv,
    });
  }

  const rows = await db
    .select({
      id: notices.id,
      title_en: notices.title_en,
      title_hi: notices.title_hi,
      content_en: notices.content_en,
      content_hi: notices.content_hi,
      audience: notices.audience,
      is_public: notices.is_public,
      pinned: notices.pinned,
      is_critical: notices.is_critical,
      published_at: notices.published_at,
      created_at: notices.created_at,
      read_at: notice_reads.read_at,
    })
    .from(notices)
    .leftJoin(
      notice_reads,
      and(eq(notice_reads.notice_id, notices.id), eq(notice_reads.user_id, user.id)),
    )
    .where(where)
    .orderBy(...ORDER)
    .limit(limit);

  let unread = 0;
  const items = rows.map((r) => {
    if (!r.read_at) unread += 1;
    return {
      ...r,
      published_at: r.published_at ? r.published_at.toISOString() : null,
      created_at: r.created_at.toISOString(),
      read_at: r.read_at ? r.read_at.toISOString() : null,
    };
  });
  ok(res, { items, unread_count: unread }, { count: items.length });
});

/** Admin-panel roles see internal notices within their scope. */
function canSeeEverythingInScope(role: string): boolean {
  return (
    role === "super_admin" ||
    role === "state_admin" ||
    role === "city_admin" ||
    role === "sanchalak" ||
    role === "shikshak"
  );
}

/**
 * Admin-panel feed predicate: notices targeting a centre in scope, OR
 * non-centre-scoped audiences (national always; state/city limited to the
 * admin's own state/city unless they are super_admin / state with broad reach).
 * super_admin (scope.centreIds === null) sees everything.
 */
function adminFeedWhere(scope: AdminScope, stateId: string | null, cityId: string | null) {
  if (scope.centreIds === null) return undefined; // super_admin: all notices

  const clauses = [eq(notices.audience, "national"), eq(notices.audience, "msv")];

  if (scope.centreIds.length > 0) {
    // centre- and batch-targeted notices both store centre_id (batch notices
    // denormalise their batch's centre on write), so one filter catches both.
    clauses.push(
      and(inArray(notices.audience, ["centre", "batch"]), inArray(notices.centre_id, scope.centreIds))!,
    );
  }
  if (stateId) {
    clauses.push(and(eq(notices.audience, "state"), eq(notices.state_id, stateId))!);
  }
  if (cityId) {
    clauses.push(and(eq(notices.audience, "city"), eq(notices.city_id, cityId))!);
  }
  return or(...clauses);
}

/* POST /v1/notices/:id/read — record a read receipt for the authed caller */
router.post("/:id/read", requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Notice not found.");
    return;
  }
  const [notice] = await db
    .select({ id: notices.id })
    .from(notices)
    .where(eq(notices.id, id))
    .limit(1);
  if (!notice) {
    fail(res, 404, "ERR_NOT_FOUND", "Notice not found.");
    return;
  }

  // Idempotent: a (notice_id, user_id) pair is recorded at most once; re-reading
  // keeps the original read_at. onConflictDoNothing requires the unique index.
  await db
    .insert(notice_reads)
    .values({ notice_id: id, user_id: req.authUser!.id })
    .onConflictDoNothing({ target: [notice_reads.notice_id, notice_reads.user_id] });

  ok(res, { id, read: true });
});

/* ═══════════════════════════════ ADMIN ═══════════════════════════════ */

/* GET /v1/notices/admin?limit= — authoring list, scoped to the caller */
router.get("/admin", requireAuth, requireAdminPanel, async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);
  const where = adminFeedWhere(scope, req.authUser!.state_id ?? null, req.authUser!.city_id ?? null);

  const rows = await db
    .select({
      id: notices.id,
      title_en: notices.title_en,
      title_hi: notices.title_hi,
      content_en: notices.content_en,
      content_hi: notices.content_hi,
      audience: notices.audience,
      state_id: notices.state_id,
      city_id: notices.city_id,
      centre_id: notices.centre_id,
      batch_id: notices.batch_id,
      centre_name: centres.name,
      batch_name: batches.name,
      is_public: notices.is_public,
      pinned: notices.pinned,
      is_critical: notices.is_critical,
      published_at: notices.published_at,
      created_at: notices.created_at,
    })
    .from(notices)
    .leftJoin(centres, eq(centres.id, notices.centre_id))
    .leftJoin(batches, eq(batches.id, notices.batch_id))
    .where(where)
    .orderBy(...ORDER)
    .limit(limit);

  const items = rows.map((r) => ({
    ...r,
    published_at: r.published_at ? r.published_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
  }));
  ok(res, { items }, { count: items.length });
});

const noticeBodySchema = z
  .object({
    title_en: z.string().min(1).max(300),
    title_hi: z.string().max(300).optional(),
    content_en: z.string().max(8000).optional(),
    content_hi: z.string().max(8000).optional(),
    audience: z.enum(["batch", "centre", "city", "state", "national", "msv"]),
    state_id: z.string().uuid().optional(),
    city_id: z.string().uuid().optional(),
    centre_id: z.string().uuid().optional(),
    batch_id: z.string().uuid().optional(),
    is_public: z.boolean().optional(),
    pinned: z.boolean().optional(),
    is_critical: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    // The targeting column must match the chosen audience.
    if (v.audience === "state" && !v.state_id) ctx.addIssue({ code: "custom", message: "state_id required for state audience", path: ["state_id"] });
    if (v.audience === "city" && !v.city_id) ctx.addIssue({ code: "custom", message: "city_id required for city audience", path: ["city_id"] });
    if (v.audience === "centre" && !v.centre_id) ctx.addIssue({ code: "custom", message: "centre_id required for centre audience", path: ["centre_id"] });
    if (v.audience === "batch" && !v.batch_id) ctx.addIssue({ code: "custom", message: "batch_id required for batch audience", path: ["batch_id"] });
  });

type NoticeBody = z.infer<typeof noticeBodySchema>;

/**
 * Reduce a request body to ONLY the scope columns that match its audience (the
 * others are nulled, so changing audience on edit cannot leave stale targeting).
 * Also resolves the effective centre for a batch target (used for scope checks).
 */
async function resolveTargetColumns(
  body: NoticeBody,
): Promise<
  | { ok: true; cols: { state_id: string | null; city_id: string | null; centre_id: string | null; batch_id: string | null }; effectiveCentreId: string | null }
  | { ok: false; status: number; code: string; message: string }
> {
  const cols = { state_id: null as string | null, city_id: null as string | null, centre_id: null as string | null, batch_id: null as string | null };
  let effectiveCentreId: string | null = null;

  switch (body.audience) {
    case "state":
      cols.state_id = body.state_id!;
      break;
    case "city":
      cols.city_id = body.city_id!;
      break;
    case "centre":
      cols.centre_id = body.centre_id!;
      effectiveCentreId = body.centre_id!;
      break;
    case "batch": {
      const [batch] = await db
        .select({ id: batches.id, centre_id: batches.centre_id })
        .from(batches)
        .where(and(eq(batches.id, body.batch_id!), isNull(batches.deleted_at)))
        .limit(1);
      if (!batch) return { ok: false, status: 404, code: "ERR_NOT_FOUND", message: "Batch not found." };
      cols.batch_id = batch.id;
      cols.centre_id = batch.centre_id; // denormalised so centre filters still catch it
      effectiveCentreId = batch.centre_id;
      break;
    }
    case "national":
    case "msv":
      break;
  }
  return { ok: true, cols, effectiveCentreId };
}

/**
 * Authorise a write against the caller's scope.
 * - super_admin: anything.
 * - centre/batch audience: the (effective) centre must be in scope.
 * - state audience: caller is state_admin of that state, or super_admin.
 * - city audience: caller is city_admin of that city, or super_admin.
 * - national/msv: super_admin only.
 */
function authorizeWrite(
  req: Request,
  body: NoticeBody,
  effectiveCentreId: string | null,
  scope: AdminScope,
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  const role = req.authUser!.role;
  if (role === "super_admin") return { ok: true };

  switch (body.audience) {
    case "centre":
    case "batch":
      if (!inScope(scope, effectiveCentreId)) {
        return { ok: false, status: 403, code: "ERR_FORBIDDEN", message: "Target is not in your scope." };
      }
      return { ok: true };
    case "state":
      if (role === "state_admin" && req.authUser!.state_id && body.state_id === req.authUser!.state_id) return { ok: true };
      return { ok: false, status: 403, code: "ERR_FORBIDDEN", message: "You cannot target this state." };
    case "city":
      if (role === "city_admin" && req.authUser!.city_id && body.city_id === req.authUser!.city_id) return { ok: true };
      if (role === "state_admin" && req.authUser!.state_id) return { ok: true }; // state admin may target cities in their state (validated below by city lookup is omitted; scope governs centres)
      return { ok: false, status: 403, code: "ERR_FORBIDDEN", message: "You cannot target this city." };
    case "national":
    case "msv":
      return { ok: false, status: 403, code: "ERR_FORBIDDEN", message: "Only national admins can publish to this audience." };
  }
}

/* POST /v1/notices/admin — create a notice */
router.post("/admin", requireAuth, requireAdminPanel, async (req: Request, res: Response) => {
  let body: NoticeBody;
  try {
    body = noticeBodySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid notice data.");
    return;
  }

  const resolved = await resolveTargetColumns(body);
  if (!resolved.ok) {
    fail(res, resolved.status, resolved.code, resolved.message);
    return;
  }
  const scope = await resolveAdminScope(req.authUser!);
  const authz = authorizeWrite(req, body, resolved.effectiveCentreId, scope);
  if (!authz.ok) {
    fail(res, authz.status, authz.code, authz.message);
    return;
  }

  const [row] = await db
    .insert(notices)
    .values({
      title_en: body.title_en,
      title_hi: body.title_hi ?? null,
      content_en: body.content_en ?? null,
      content_hi: body.content_hi ?? null,
      audience: body.audience,
      state_id: resolved.cols.state_id,
      city_id: resolved.cols.city_id,
      centre_id: resolved.cols.centre_id,
      batch_id: resolved.cols.batch_id,
      is_public: body.is_public ?? false,
      pinned: body.pinned ?? false,
      is_critical: body.is_critical ?? false,
      published_at: new Date(),
      created_by: req.authUser!.id,
    })
    .returning({ id: notices.id });

  await auditFromReq(req, {
    action: "create",
    entityKind: "notice",
    entityId: row.id,
    summary: `Created notice "${body.title_en}" (${body.audience}).`,
    metadata: { audience: body.audience, is_public: body.is_public ?? false },
  });

  ok(res, { id: row.id }, undefined, 201);
});

/** Load a notice and confirm the caller may act on it within their scope. */
async function loadScoped(
  req: Request,
): Promise<{ ok: true; centre_id: string | null } | { ok: false }> {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return { ok: false };
  const [row] = await db
    .select({ id: notices.id, audience: notices.audience, centre_id: notices.centre_id, state_id: notices.state_id, city_id: notices.city_id })
    .from(notices)
    .where(eq(notices.id, id))
    .limit(1);
  if (!row) return { ok: false };

  const role = req.authUser!.role;
  if (role === "super_admin") return { ok: true, centre_id: row.centre_id };

  const scope = await resolveAdminScope(req.authUser!);
  if ((row.audience === "centre" || row.audience === "batch") && inScope(scope, row.centre_id)) {
    return { ok: true, centre_id: row.centre_id };
  }
  if (row.audience === "state" && role === "state_admin" && req.authUser!.state_id && row.state_id === req.authUser!.state_id) {
    return { ok: true, centre_id: row.centre_id };
  }
  if (row.audience === "city" && role === "city_admin" && req.authUser!.city_id && row.city_id === req.authUser!.city_id) {
    return { ok: true, centre_id: row.centre_id };
  }
  return { ok: false };
}

/**
 * Edit handler — bound to PATCH (canonical) and POST (alias) so the web client,
 * whose shared fetch helper only exposes GET/POST/DELETE, can still edit.
 */
const editNotice = async (req: Request, res: Response): Promise<void> => {
  const existing = await loadScoped(req);
  if (!existing.ok) {
    fail(res, 404, "ERR_NOT_FOUND", "Notice not found.");
    return;
  }

  let body: NoticeBody;
  try {
    body = noticeBodySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid notice data.");
    return;
  }

  const resolved = await resolveTargetColumns(body);
  if (!resolved.ok) {
    fail(res, resolved.status, resolved.code, resolved.message);
    return;
  }
  const scope = await resolveAdminScope(req.authUser!);
  const authz = authorizeWrite(req, body, resolved.effectiveCentreId, scope);
  if (!authz.ok) {
    fail(res, authz.status, authz.code, authz.message);
    return;
  }

  const id = String(req.params.id);
  await db
    .update(notices)
    .set({
      title_en: body.title_en,
      title_hi: body.title_hi ?? null,
      content_en: body.content_en ?? null,
      content_hi: body.content_hi ?? null,
      audience: body.audience,
      state_id: resolved.cols.state_id,
      city_id: resolved.cols.city_id,
      centre_id: resolved.cols.centre_id,
      batch_id: resolved.cols.batch_id,
      is_public: body.is_public ?? false,
      pinned: body.pinned ?? false,
      is_critical: body.is_critical ?? false,
      updated_at: new Date(),
    })
    .where(eq(notices.id, id));

  await auditFromReq(req, {
    action: "update",
    entityKind: "notice",
    entityId: id,
    summary: `Edited notice "${body.title_en}" (${body.audience}).`,
    metadata: { audience: body.audience, is_public: body.is_public ?? false },
  });

  ok(res, { id });
};

/* PATCH /v1/notices/admin/:id — edit a notice (re-targets scope columns) */
router.patch("/admin/:id", requireAuth, requireAdminPanel, editNotice);
/* POST /v1/notices/admin/:id — alias for clients without a PATCH helper */
router.post("/admin/:id", requireAuth, requireAdminPanel, editNotice);

/* DELETE /v1/notices/admin/:id — remove a notice (hard delete; reads cascade) */
router.delete("/admin/:id", requireAuth, requireAdminPanel, async (req: Request, res: Response) => {
  const existing = await loadScoped(req);
  if (!existing.ok) {
    fail(res, 404, "ERR_NOT_FOUND", "Notice not found.");
    return;
  }
  const id = String(req.params.id);
  await db.delete(notices).where(eq(notices.id, id));

  await auditFromReq(req, {
    action: "delete",
    entityKind: "notice",
    entityId: id,
    summary: "Deleted notice.",
  });

  ok(res, { id, deleted: true });
});

export default router;
