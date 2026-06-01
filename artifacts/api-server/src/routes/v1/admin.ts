import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  students,
  enrolments,
  batches,
  centres,
  users,
  sessions,
  attendance,
  punya_transactions,
  msv_enrolments,
} from "@workspace/db";
import { and, asc, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  enrolmentActionSchema,
  studentStatusActionSchema,
  enrolmentStatusSchema,
  type Role,
} from "@workspace/api-zod";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, type AdminScope } from "../../lib/scope";
import adminResourcesRouter from "./admin-resources";
import adminModulesRouter from "./admin-modules";

const router: IRouter = Router();

router.use(requireAuth, requireAdminPanel);
router.use(adminResourcesRouter);
router.use(adminModulesRouter);

/** Returns a Drizzle condition limiting `column` to the user's scope, or undefined for unrestricted. */
function scopedCentreFilter(scope: AdminScope, column: PgColumn) {
  if (scope.centreIds === null) return undefined;
  if (scope.centreIds.length === 0) return sql`false`;
  return inArray(column, scope.centreIds);
}

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/* GET /v1/admin/analytics/overview */
router.get("/analytics/overview", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const centreFilter = scopedCentreFilter(scope, students.centre_id);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [activeStudents] = await db
    .select({ n: count() })
    .from(students)
    .where(and(eq(students.status, "active"), centreFilter));

  // Centres in scope.
  const centreScope = scopedCentreFilter(scope, centres.id);
  const [centreCount] = await db
    .select({ n: count() })
    .from(centres)
    .where(and(eq(centres.status, "active"), centreScope));

  // Pending enrolments (open requests) in scope.
  const enrolCentreFilter = scopedCentreFilter(scope, enrolments.requested_centre_id);
  const [openReq] = await db
    .select({ n: count() })
    .from(enrolments)
    .where(and(eq(enrolments.status, "pending"), enrolCentreFilter));

  // MSV approved students in scope.
  const [msvActive] = await db
    .select({ n: count() })
    .from(students)
    .where(and(eq(students.msv_status, "approved"), centreFilter));

  // Attendance rate over last 30 days (within scoped batches via session->batch->centre).
  const attendanceCentreFilter =
    scope.centreIds === null
      ? undefined
      : scope.centreIds.length === 0
        ? sql`false`
        : inArray(batches.centre_id, scope.centreIds);
  const [attRow] = await db
    .select({
      total: count(),
      present: sql<number>`count(*) filter (where ${attendance.status} in ('present','late'))::int`,
    })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.session_id))
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .where(and(gte(sessions.session_date, since.toISOString().slice(0, 10)), attendanceCentreFilter));
  const attendanceRate =
    attRow && attRow.total > 0 ? Math.round((Number(attRow.present) / attRow.total) * 1000) / 10 : 0;

  // Punya awarded in last 30 days within scope.
  const punyaCentreFilter = scopedCentreFilter(scope, students.centre_id);
  const [punyaRow] = await db
    .select({ sum: sql<number>`coalesce(sum(${punya_transactions.points}),0)::int` })
    .from(punya_transactions)
    .innerJoin(students, eq(students.id, punya_transactions.student_id))
    .where(and(gte(punya_transactions.created_at, since), punyaCentreFilter));

  ok(res, {
    active_students: activeStudents?.n ?? 0,
    centres: centreCount?.n ?? 0,
    open_service_requests: openReq?.n ?? 0,
    attendance_rate_30d: attendanceRate,
    punya_awarded_30d: Number(punyaRow?.sum ?? 0),
    msv_active: msvActive?.n ?? 0,
    donations_total_paise_ytd: 0,
  });
  void msv_enrolments;
});

/* GET /v1/admin/students?limit= */
router.get("/students", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 500);
  const centreFilter = scopedCentreFilter(scope, students.centre_id);

  const rows = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      student_code: students.student_code,
      age_group: students.age_group,
      dob: students.dob,
      msv_status: students.msv_status,
      status: students.status,
    })
    .from(students)
    .where(centreFilter)
    .orderBy(desc(students.created_at))
    .limit(limit);

  ok(res, { items: rows }, { count: rows.length });
});

/* POST /v1/admin/students/:id/status */
router.post("/students/:id/status", async (req: Request, res: Response) => {
  let body: z.infer<typeof studentStatusActionSchema>;
  try {
    body = studentStatusActionSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid action.");
    return;
  }
  const scope = await resolveAdminScope(req.authUser!);
  const [student] = await db.select().from(students).where(eq(students.id, String(req.params.id))).limit(1);
  if (!student || !inScope(scope, student.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found in your scope.");
    return;
  }
  const nextStatus = body.action === "deactivate" ? "inactive" : "active";
  await db.update(students).set({ status: nextStatus }).where(eq(students.id, student.id));
  ok(res, { id: student.id, status: nextStatus });
});

/* GET /v1/admin/batches */
router.get("/batches", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const centreFilter = scopedCentreFilter(scope, batches.centre_id);

  const rows = await db
    .select({
      id: batches.id,
      name: batches.name,
      centre_name: centres.name,
      age_group: batches.age_group,
      shikshak_name: users.full_name,
      day_of_week: batches.day_of_week,
      start_time: batches.start_time,
      end_time: batches.end_time,
      status: batches.status,
    })
    .from(batches)
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .leftJoin(users, eq(users.id, batches.shikshak_id))
    .where(centreFilter)
    .orderBy(asc(centres.name), asc(batches.name));

  ok(res, { items: rows }, { count: rows.length });
});

/* POST /v1/admin/batches/:id/:action */
router.post("/batches/:id/:action", async (req: Request, res: Response) => {
  const action = String(req.params.action);
  if (action !== "activate" && action !== "deactivate") {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Unknown action.");
    return;
  }
  const scope = await resolveAdminScope(req.authUser!);
  const [batch] = await db.select().from(batches).where(eq(batches.id, String(req.params.id))).limit(1);
  if (!batch || !inScope(scope, batch.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Batch not found in your scope.");
    return;
  }
  const nextStatus = action === "activate" ? "active" : "inactive";
  await db.update(batches).set({ status: nextStatus }).where(eq(batches.id, batch.id));
  ok(res, { id: batch.id, status: nextStatus });
});

/* GET /v1/admin/enrolments?status=&limit= */
router.get("/enrolments", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 500);
  const statusParam = req.query.status;
  let statusFilter;
  if (typeof statusParam === "string" && statusParam.length > 0) {
    const parsed = enrolmentStatusSchema.safeParse(statusParam);
    if (!parsed.success) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Unknown status filter.");
      return;
    }
    statusFilter = eq(enrolments.status, parsed.data);
  }
  const centreFilter = scopedCentreFilter(scope, enrolments.requested_centre_id);

  const reqCentre = centres;
  const reqBatch = batches;
  const rows = await db
    .select({
      id: enrolments.id,
      created_at: enrolments.created_at,
      decided_at: enrolments.decided_at,
      requested_centre_id: enrolments.requested_centre_id,
      requested_batch_id: enrolments.requested_batch_id,
      status: enrolments.status,
      student_name: students.full_name,
      student_code: students.student_code,
      centre_name: reqCentre.name,
      batch_name: reqBatch.name,
    })
    .from(enrolments)
    .innerJoin(students, eq(students.id, enrolments.student_id))
    .innerJoin(reqCentre, eq(reqCentre.id, enrolments.requested_centre_id))
    .innerJoin(reqBatch, eq(reqBatch.id, enrolments.requested_batch_id))
    .where(and(statusFilter, centreFilter))
    .orderBy(desc(enrolments.created_at))
    .limit(limit);

  const items = rows.map((r) => ({
    ...r,
    created_at: r.created_at.toISOString(),
    decided_at: r.decided_at ? r.decided_at.toISOString() : null,
  }));
  ok(res, { items }, { count: items.length });
});

/* POST /v1/admin/enrolments/:id/:action  (approve|waitlist|reject) */
router.post("/enrolments/:id/:action", async (req: Request, res: Response) => {
  const action = String(req.params.action);
  const map: Record<string, "approved" | "waitlisted" | "rejected"> = {
    approve: "approved",
    waitlist: "waitlisted",
    reject: "rejected",
  };
  const nextStatus = map[action];
  if (!nextStatus) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Unknown action.");
    return;
  }
  let body: z.infer<typeof enrolmentActionSchema>;
  try {
    body = enrolmentActionSchema.parse(req.body ?? {});
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid body.");
    return;
  }
  if (nextStatus === "rejected" && !body.reason) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "A reason is required to reject.");
    return;
  }

  const scope = await resolveAdminScope(req.authUser!);
  const [enrolment] = await db.select().from(enrolments).where(eq(enrolments.id, String(req.params.id))).limit(1);
  if (!enrolment || !inScope(scope, enrolment.requested_centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Enrolment not found in your scope.");
    return;
  }

  await db
    .update(enrolments)
    .set({
      status: nextStatus,
      reason: body.reason ?? null,
      decided_by: req.authUser!.id,
      decided_at: new Date(),
    })
    .where(eq(enrolments.id, enrolment.id));

  // On approval, attach the student to the requested centre/batch and activate.
  if (nextStatus === "approved") {
    await db
      .update(students)
      .set({
        centre_id: enrolment.requested_centre_id,
        batch_id: enrolment.requested_batch_id,
        status: "active",
      })
      .where(eq(students.id, enrolment.student_id));
  }

  ok(res, { id: enrolment.id, status: nextStatus });
});

function inScope(scope: AdminScope, centreId: string | null): boolean {
  if (scope.centreIds === null) return true;
  if (!centreId) return false;
  return scope.centreIds.includes(centreId);
}

export default router;
