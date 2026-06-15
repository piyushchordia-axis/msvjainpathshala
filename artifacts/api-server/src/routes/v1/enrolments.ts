/**
 * /v1/enrolments — centre/batch enrolment request lifecycle.
 *
 * There is otherwise NO enrolment-creation path in the system (only the seed
 * inserts rows), so the core lifecycle is non-functional. This router supplies
 * the missing CREATE step plus a scoped list, both with the guards the decision
 * handler (in admin.ts) already assumes:
 *
 *  - owner path  : a parent/student requests a batch for a student they own.
 *                  Always lands as `pending` for an admin to decide.
 *  - admin path  : an admin-panel user enrols a student into a batch in their
 *                  scope. May `auto_approve` to attach the student immediately,
 *                  otherwise lands as `pending`.
 *
 * Both paths enforce, atomically per (student) under an advisory lock:
 *  - capacity   : the requested batch is not already full (approved students),
 *  - duplicate  : at most one live enrolment per (student, batch) — backed by
 *                 the `enrolments_student_batch_active_uq` partial unique index.
 *
 * The transition guard used by approvals/rejections is exported here so the
 * single-owner admin router can reuse it (the decision handler lives in the
 * forbidden admin.ts — see the wiring manifest for the exact patch).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, students, enrolments, batches, centres } from "@workspace/db";
import { and, eq, inArray, isNull, or, sql, desc, count } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, type AdminScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";

const router: IRouter = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---- local helpers copy-pasted into every admin route file ---- */
function scopedCentreFilter(scope: AdminScope, column: typeof enrolments.requested_centre_id) {
  if (scope.centreIds === null) return undefined;
  if (scope.centreIds.length === 0) return sql`false`;
  return inArray(column, scope.centreIds);
}
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

const ADMIN_ROLES = ["super_admin", "state_admin", "city_admin", "sanchalak", "shikshak"];
function isAdminPanelRole(role: string): boolean {
  return ADMIN_ROLES.includes(role);
}

/** Resolve a student the caller owns (parent of, or is, that student). */
async function ownedStudentId(req: Request, id: string): Promise<string | null> {
  const uid = req.authUser!.id;
  const [row] = await db
    .select({ id: students.id })
    .from(students)
    .where(
      and(
        eq(students.id, id),
        isNull(students.deleted_at),
        or(eq(students.parent_id, uid), eq(students.user_id, uid)),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/* ───────────────────────────── shared transition guard ───────────────────────────── */

export const ENROLMENT_ACTIONABLE_STATUSES = ["pending", "waitlisted"] as const;
export type EnrolmentActionableStatus = (typeof ENROLMENT_ACTIONABLE_STATUSES)[number];

/**
 * Decide whether an enrolment in `currentStatus` may move to `nextStatus`.
 *
 * Only `pending` and `waitlisted` are actionable: a decision (approved/rejected)
 * is terminal, so repeating an action — or acting on an already-decided row —
 * is rejected. This is the idempotency / state-transition guard the decision
 * handler must apply before mutating a row (it currently acts on any status,
 * repeatably). Pure + dependency-free so admin.ts can import and reuse it.
 */
export function canTransitionEnrolment(
  currentStatus: string,
  nextStatus: "approved" | "waitlisted" | "rejected",
): { ok: true } | { ok: false; reason: string } {
  if (!ENROLMENT_ACTIONABLE_STATUSES.includes(currentStatus as EnrolmentActionableStatus)) {
    return {
      ok: false,
      reason: `Enrolment is already ${currentStatus}; only pending or waitlisted enrolments can be decided.`,
    };
  }
  // No-op transition (e.g. waitlist -> waitlist) is not a real decision.
  if (currentStatus === nextStatus) {
    return { ok: false, reason: `Enrolment is already ${currentStatus}.` };
  }
  return { ok: true };
}

/* ─────────────────────────── create (owner OR admin) ─────────────────────────── */

const createSchema = z.object({
  student_id: z.string().uuid(),
  requested_batch_id: z.string().uuid(),
  reason: z.string().max(2000).optional(),
  // Admin-only: enrol straight to approved (attach the student now).
  auto_approve: z.boolean().optional(),
});

/* POST /v1/enrolments — create an enrolment request */
router.post("/", async (req: Request, res: Response) => {
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid enrolment data.");
    return;
  }

  const role = req.authUser!.role;
  const asAdmin = isAdminPanelRole(role);
  if (body.auto_approve && !asAdmin) {
    fail(res, 403, "ERR_FORBIDDEN", "Only admins may approve an enrolment on creation.");
    return;
  }

  // Resolve the requested batch + its centre (the centre is derived, never trusted
  // from the client) and validate it is enrollable.
  const [batch] = await db
    .select({
      id: batches.id,
      centre_id: batches.centre_id,
      capacity: batches.capacity,
      batch_status: batches.status,
      batch_deleted_at: batches.deleted_at,
      centre_status: centres.status,
      centre_deleted_at: centres.deleted_at,
    })
    .from(batches)
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .where(eq(batches.id, body.requested_batch_id))
    .limit(1);
  if (!batch || batch.batch_deleted_at || batch.centre_deleted_at) {
    fail(res, 404, "ERR_NOT_FOUND", "Batch not found.");
    return;
  }
  if (batch.batch_status !== "active" || batch.centre_status !== "active") {
    fail(res, 409, "ERR_BATCH_INACTIVE", "This batch is not currently accepting enrolments.");
    return;
  }

  // Authorize the (student, batch) pair for this caller.
  if (asAdmin) {
    const scope = await resolveAdminScope(req.authUser!);
    if (!inScope(scope, batch.centre_id)) {
      // Don't leak existence of out-of-scope centres.
      fail(res, 404, "ERR_NOT_FOUND", "Batch not found.");
      return;
    }
    // The student must exist (and be in scope) to be enrolled by an admin.
    const [student] = await db
      .select({ id: students.id, centre_id: students.centre_id })
      .from(students)
      .where(and(eq(students.id, body.student_id), isNull(students.deleted_at)))
      .limit(1);
    // A student with no centre yet is fine; once they have one it must be in scope.
    if (!student || !inScope(scope, student.centre_id ?? batch.centre_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Student not found in your scope.");
      return;
    }
  } else {
    if (!(await ownedStudentId(req, body.student_id))) {
      fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
      return;
    }
  }

  const nextStatus = body.auto_approve ? "approved" : "pending";

  // Serialize concurrent creates for the same student so the duplicate check, the
  // capacity check and the insert happen atomically (no check-then-insert race).
  // The advisory lock is held until the transaction commits.
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${body.student_id}::text, 0))`);

    // Duplicate guard: at most one live enrolment per (student, batch). A live
    // enrolment is any non-rejected row (pending/waitlisted/approved). Mirrors
    // the partial unique index `enrolments_student_batch_active_uq`.
    const [existing] = await tx
      .select({ id: enrolments.id, status: enrolments.status })
      .from(enrolments)
      .where(
        and(
          eq(enrolments.student_id, body.student_id),
          eq(enrolments.requested_batch_id, body.requested_batch_id),
          inArray(enrolments.status, ["pending", "waitlisted", "approved"]),
        ),
      )
      .limit(1);
    if (existing) return { kind: "duplicate" as const, existing };

    // Capacity guard (only meaningful when we'd take a seat now). Count students
    // already attached to this batch and the approved-but-not-yet-attached ones.
    if (nextStatus === "approved") {
      const [attached] = await tx
        .select({ n: count() })
        .from(students)
        .where(
          and(
            eq(students.batch_id, body.requested_batch_id),
            eq(students.status, "active"),
            isNull(students.deleted_at),
          ),
        );
      if ((attached?.n ?? 0) >= batch.capacity) {
        return { kind: "full" as const };
      }
    }

    const [row] = await tx
      .insert(enrolments)
      .values({
        student_id: body.student_id,
        requested_centre_id: batch.centre_id,
        requested_batch_id: body.requested_batch_id,
        status: nextStatus,
        reason: body.reason ?? null,
        decided_by: nextStatus === "approved" ? req.authUser!.id : null,
        decided_at: nextStatus === "approved" ? new Date() : null,
      })
      .returning({ id: enrolments.id, status: enrolments.status });

    // On direct approval, attach the student to the requested centre/batch.
    if (nextStatus === "approved") {
      await tx
        .update(students)
        .set({ centre_id: batch.centre_id, batch_id: body.requested_batch_id, status: "active" })
        .where(eq(students.id, body.student_id));
    }

    return { kind: "created" as const, row };
  });

  if (result.kind === "duplicate") {
    fail(
      res,
      409,
      "ERR_ALREADY_ENROLLED",
      `An enrolment for this student in this batch already exists (${result.existing.status}).`,
    );
    return;
  }
  if (result.kind === "full") {
    fail(res, 409, "ERR_BATCH_FULL", "This batch has no remaining capacity.");
    return;
  }

  await auditFromReq(req, {
    action: "create",
    entityKind: "enrolment",
    entityId: result.row.id,
    summary: nextStatus === "approved" ? "Enrolment created and approved." : "Enrolment requested.",
    metadata: {
      student_id: body.student_id,
      requested_batch_id: body.requested_batch_id,
      requested_centre_id: batch.centre_id,
      status: result.row.status,
      via: asAdmin ? "admin" : "owner",
    },
  });

  ok(res, { id: result.row.id, status: result.row.status }, undefined, 201);
});

/* ─────────────────────────── scoped list ─────────────────────────── */

const statusSchema = z.enum(["pending", "approved", "rejected", "waitlisted"]);
const listQuerySchema = z.object({
  batch_id: z.string().uuid().optional(),
  centre_id: z.string().uuid().optional(),
  status: statusSchema.optional(),
});

/* GET /v1/enrolments?batch_id=&centre_id=&status=&limit= — scoped list (admin) */
router.get("/", requireAdminPanel, async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid filter.");
    return;
  }
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 500);

  const filters = [
    scopedCentreFilter(scope, enrolments.requested_centre_id),
    isNull(students.deleted_at),
    parsed.data.batch_id ? eq(enrolments.requested_batch_id, parsed.data.batch_id) : undefined,
    parsed.data.centre_id ? eq(enrolments.requested_centre_id, parsed.data.centre_id) : undefined,
    parsed.data.status ? eq(enrolments.status, parsed.data.status) : undefined,
  ];

  const rows = await db
    .select({
      id: enrolments.id,
      created_at: enrolments.created_at,
      decided_at: enrolments.decided_at,
      requested_centre_id: enrolments.requested_centre_id,
      requested_batch_id: enrolments.requested_batch_id,
      status: enrolments.status,
      reason: enrolments.reason,
      student_name: students.full_name,
      student_code: students.student_code,
      centre_name: centres.name,
      batch_name: batches.name,
    })
    .from(enrolments)
    .innerJoin(students, eq(students.id, enrolments.student_id))
    .innerJoin(centres, eq(centres.id, enrolments.requested_centre_id))
    .innerJoin(batches, eq(batches.id, enrolments.requested_batch_id))
    .where(and(...filters))
    .orderBy(desc(enrolments.created_at))
    .limit(limit);

  const items = rows.map((r) => ({
    ...r,
    created_at: r.created_at.toISOString(),
    decided_at: r.decided_at ? r.decided_at.toISOString() : null,
  }));
  ok(res, { items }, { count: items.length });
});

export default router;
