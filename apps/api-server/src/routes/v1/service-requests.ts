/**
 * /v1/service-requests — threaded parent<->admin support requests.
 *
 * Parents (any authed user) create requests and read/reply to their own.
 * Admins read/assign/resolve requests within their centre/city scope.
 *
 * Authorization model:
 *  - owner  : parent_user_id === authUser.id
 *  - admin  : requireAdminPanel + the request's centre_id is in the admin's scope
 *             (super_admin sees all). A request with no centre_id is only visible
 *             to super_admin on the admin surface.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, service_requests, service_request_messages, students, centres, users } from "@workspace/db";
import { SERVICE_REQUEST_STATUSES } from "@workspace/db/enums";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, type AdminScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import { clampLimit, inScope, scopedCentreFilter } from "../../lib/route-helpers";

const router: IRouter = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/** Resolve a student the caller owns (parent of, or is, that student). */
async function ownedStudentId(req: Request, id: string): Promise<string | null> {
  const uid = req.authUser!.id;
  const [row] = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.id, id), or(eq(students.parent_id, uid), eq(students.user_id, uid))))
    .limit(1);
  return row?.id ?? null;
}

/* ─────────────────────────── parent / owner surface ─────────────────────────── */

const createRequestSchema = z.object({
  category: z.string().min(1).max(120),
  subject: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  student_id: z.string().uuid().optional(),
});

/* POST /v1/service-requests — create a request (owner = caller) */
router.post("/", async (req: Request, res: Response) => {
  let body: z.infer<typeof createRequestSchema>;
  try { body = createRequestSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid service request data."); return; }

  let centreId: string | null = null;
  let cityId: string | null = null;
  let studentId: string | null = null;

  if (body.student_id) {
    if (!(await ownedStudentId(req, body.student_id))) {
      fail(res, 404, "ERR_NOT_FOUND", "Student not found."); return;
    }
    studentId = body.student_id;
    const [row] = await db
      .select({ centre_id: students.centre_id, city_id: centres.city_id })
      .from(students)
      .leftJoin(centres, eq(centres.id, students.centre_id))
      .where(eq(students.id, body.student_id))
      .limit(1);
    centreId = row?.centre_id ?? null;
    cityId = row?.city_id ?? null;
  }

  const [created] = await db
    .insert(service_requests)
    .values({
      parent_user_id: req.authUser!.id,
      student_id: studentId,
      category: body.category,
      subject: body.subject,
      description: body.description,
      status: "submitted",
      centre_id: centreId,
      city_id: cityId,
    })
    .returning({ id: service_requests.id, status: service_requests.status });
  ok(res, created);
});

/* GET /v1/service-requests/mine — caller's own requests, newest first */
router.get("/mine", async (req: Request, res: Response) => {
  const limit = clampLimit(req.query.limit, 100, 300);
  const rows = await db
    .select({
      id: service_requests.id,
      category: service_requests.category,
      subject: service_requests.subject,
      status: service_requests.status,
      student_name: students.full_name,
      last_response_at: service_requests.last_response_at,
      resolved_at: service_requests.resolved_at,
      created_at: service_requests.created_at,
    })
    .from(service_requests)
    .leftJoin(students, eq(students.id, service_requests.student_id))
    .where(eq(service_requests.parent_user_id, req.authUser!.id))
    .orderBy(desc(service_requests.created_at))
    .limit(limit);
  const items = rows.map((r) => ({
    ...r,
    last_response_at: r.last_response_at ? r.last_response_at.toISOString() : null,
    resolved_at: r.resolved_at ? r.resolved_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
  }));
  ok(res, { items }, { count: items.length });
});

/* GET /v1/service-requests — admin list in scope (must be ABOVE /:id) */
const statusQuerySchema = z.enum(["submitted", "in_review", "resolved"]).optional();
router.get("/", requireAdminPanel, async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);

  const parsedStatus = statusQuerySchema.safeParse(req.query.status);
  if (!parsedStatus.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid status filter."); return;
  }

  const centreFilter = scopedCentreFilter(scope, service_requests.centre_id);
  const statusFilter = parsedStatus.data
    ? eq(service_requests.status, parsedStatus.data)
    : undefined;

  const assignee = alias(users, "assignee");
  const rows = await db
    .select({
      id: service_requests.id,
      category: service_requests.category,
      subject: service_requests.subject,
      status: service_requests.status,
      parent_name: users.full_name,
      student_name: students.full_name,
      centre_name: centres.name,
      assigned_to: service_requests.assigned_to,
      assigned_name: assignee.full_name,
      last_response_at: service_requests.last_response_at,
      resolved_at: service_requests.resolved_at,
      created_at: service_requests.created_at,
    })
    .from(service_requests)
    .leftJoin(users, eq(users.id, service_requests.parent_user_id))
    .leftJoin(students, eq(students.id, service_requests.student_id))
    .leftJoin(centres, eq(centres.id, service_requests.centre_id))
    .leftJoin(assignee, eq(assignee.id, service_requests.assigned_to))
    .where(and(centreFilter, statusFilter))
    .orderBy(desc(service_requests.created_at))
    .limit(limit);
  const items = rows.map((r) => ({
    ...r,
    last_response_at: r.last_response_at ? r.last_response_at.toISOString() : null,
    resolved_at: r.resolved_at ? r.resolved_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
  }));
  ok(res, { items }, { count: items.length });
});

type AccessibleRow = {
  id: string;
  parent_user_id: string;
  centre_id: string | null;
  status: (typeof SERVICE_REQUEST_STATUSES)[number];
  assigned_to: string | null;
};

/** Load a request and decide whether the caller may view/act on it. */
async function loadAccessible(req: Request): Promise<
  | { ok: true; row: AccessibleRow; isOwner: boolean }
  | { ok: false }
> {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return { ok: false };
  const [row] = await db
    .select({
      id: service_requests.id,
      parent_user_id: service_requests.parent_user_id,
      centre_id: service_requests.centre_id,
      status: service_requests.status,
      assigned_to: service_requests.assigned_to,
    })
    .from(service_requests)
    .where(eq(service_requests.id, id))
    .limit(1);
  if (!row) return { ok: false };

  if (row.parent_user_id === req.authUser!.id) return { ok: true, row, isOwner: true };

  // Not the owner — only an in-scope admin-panel user may see it.
  const role = req.authUser!.role;
  const isAdminPanel =
    role === "super_admin" ||
    role === "state_admin" ||
    role === "city_admin" ||
    role === "sanchalak" ||
    role === "shikshak";
  if (!isAdminPanel) return { ok: false };
  const scope = await resolveAdminScope(req.authUser!);
  if (!inScope(scope, row.centre_id)) return { ok: false };
  return { ok: true, row, isOwner: false };
}

/* GET /v1/service-requests/:id — the request plus its ordered message thread */
router.get("/:id", async (req: Request, res: Response) => {
  const access = await loadAccessible(req);
  if (!access.ok) {
    fail(res, 404, "ERR_NOT_FOUND", "Service request not found."); return;
  }

  const assignee = alias(users, "assignee");
  const [detail] = await db
    .select({
      id: service_requests.id,
      category: service_requests.category,
      subject: service_requests.subject,
      description: service_requests.description,
      status: service_requests.status,
      parent_name: users.full_name,
      student_name: students.full_name,
      centre_name: centres.name,
      assigned_to: service_requests.assigned_to,
      assigned_name: assignee.full_name,
      last_response_at: service_requests.last_response_at,
      resolved_at: service_requests.resolved_at,
      created_at: service_requests.created_at,
    })
    .from(service_requests)
    .leftJoin(users, eq(users.id, service_requests.parent_user_id))
    .leftJoin(students, eq(students.id, service_requests.student_id))
    .leftJoin(centres, eq(centres.id, service_requests.centre_id))
    .leftJoin(assignee, eq(assignee.id, service_requests.assigned_to))
    .where(eq(service_requests.id, access.row.id))
    .limit(1);

  const messages = await db
    .select({
      id: service_request_messages.id,
      message: service_request_messages.message,
      author_user_id: service_request_messages.author_user_id,
      author_name: users.full_name,
      created_at: service_request_messages.created_at,
    })
    .from(service_request_messages)
    .leftJoin(users, eq(users.id, service_request_messages.author_user_id))
    .where(eq(service_request_messages.request_id, access.row.id))
    .orderBy(asc(service_request_messages.created_at));

  ok(res, {
    ...detail,
    last_response_at: detail.last_response_at ? detail.last_response_at.toISOString() : null,
    resolved_at: detail.resolved_at ? detail.resolved_at.toISOString() : null,
    created_at: detail.created_at.toISOString(),
    messages: messages.map((m) => ({ ...m, created_at: m.created_at.toISOString() })),
  });
});

const postMessageSchema = z.object({
  message: z.string().min(1).max(5000),
});

/**
 * Decide the request's status after a new message is posted, preserving the
 * invariant `resolved_at IS NOT NULL ⇔ status === "resolved"`.
 *
 *  - Replying to a *resolved* request reopens it: back to `in_review` if an
 *    admin is already assigned, otherwise back to `submitted`. `resolved_at`
 *    is cleared so it never lingers on a non-resolved request.
 *  - Replying to a `submitted` / `in_review` request leaves the status (and the
 *    already-null `resolved_at`) untouched — only `last_response_at` advances.
 *
 * `reopened` tells the caller whether to clear `resolved_at`; `last_response_at`
 * is bumped by the caller in every case.
 */
function reopenTransition(
  row: AccessibleRow,
): { status: (typeof SERVICE_REQUEST_STATUSES)[number]; reopened: boolean } {
  if (row.status === "resolved") {
    return { status: row.assigned_to ? "in_review" : "submitted", reopened: true };
  }
  return { status: row.status, reopened: false };
}

/* POST /v1/service-requests/:id/messages — owner or in-scope admin replies */
router.post("/:id/messages", async (req: Request, res: Response) => {
  let body: z.infer<typeof postMessageSchema>;
  try { body = postMessageSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid message data."); return; }

  const access = await loadAccessible(req);
  if (!access.ok) {
    fail(res, 404, "ERR_NOT_FOUND", "Service request not found."); return;
  }

  const now = new Date();
  const [msg] = await db
    .insert(service_request_messages)
    .values({
      request_id: access.row.id,
      author_user_id: req.authUser!.id,
      message: body.message,
    })
    .returning({ id: service_request_messages.id });

  // Keep status / resolved_at consistent with the new reply (see reopenTransition).
  const { status, reopened } = reopenTransition(access.row);
  await db
    .update(service_requests)
    .set(
      reopened
        ? { last_response_at: now, status, resolved_at: null }
        : { last_response_at: now },
    )
    .where(eq(service_requests.id, access.row.id));

  await auditFromReq(req, {
    action: reopened ? "update" : "create",
    entityKind: "service_request",
    entityId: access.row.id,
    summary: reopened
      ? `Replied on a resolved request — reopened (status → ${status}).`
      : `Posted a message on service request (by ${access.isOwner ? "requester" : "admin"}).`,
    metadata: { reopened, status, by: access.isOwner ? "requester" : "admin" },
  });

  ok(res, { id: msg.id, status, reopened });
});

/* ─────────────────────────── admin actions ─────────────────────────── */

/** Load a request and guard it against the admin's scope (404 if out of scope). */
async function loadInAdminScope(req: Request, res: Response): Promise<{ id: string } | null> {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Service request not found."); return null;
  }
  const scope = await resolveAdminScope(req.authUser!);
  const [row] = await db
    .select({ id: service_requests.id, centre_id: service_requests.centre_id })
    .from(service_requests)
    .where(eq(service_requests.id, id))
    .limit(1);
  if (!row || !inScope(scope, row.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Service request not found."); return null;
  }
  return { id: row.id };
}

/* POST /v1/service-requests/:id/assign — claim the request (admin) */
router.post("/:id/assign", requireAdminPanel, async (req: Request, res: Response) => {
  const row = await loadInAdminScope(req, res);
  if (!row) return;

  // Assigning moves the request into review; clear resolved_at so the
  // `resolved_at ⇔ status === "resolved"` invariant holds even if a resolved
  // request is re-claimed.
  await db
    .update(service_requests)
    .set({ assigned_to: req.authUser!.id, status: "in_review", resolved_at: null })
    .where(eq(service_requests.id, row.id));
  await auditFromReq(req, {
    action: "assign",
    entityKind: "service_request",
    entityId: row.id,
    summary: "Assigned service request to self.",
  });
  ok(res, { id: row.id, status: "in_review" });
});

/* POST /v1/service-requests/:id/resolve — mark resolved (admin) */
router.post("/:id/resolve", requireAdminPanel, async (req: Request, res: Response) => {
  const row = await loadInAdminScope(req, res);
  if (!row) return;

  await db
    .update(service_requests)
    .set({ status: "resolved", resolved_at: new Date() })
    .where(eq(service_requests.id, row.id));
  await auditFromReq(req, {
    action: "resolve",
    entityKind: "service_request",
    entityId: row.id,
    summary: "Resolved service request.",
  });
  ok(res, { id: row.id, status: "resolved" });
});

export default router;
