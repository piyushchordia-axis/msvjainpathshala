/**
 * /v1/sessions — frozen attendance route table only (CLAUDE.md).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { ulidSchema, attendanceStatusSchema } from "@workspace/api-zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope } from "../../lib/scope";
import { db, sessions, batches, attendance, centres } from "@workspace/db";
import { and, eq, sql, desc, inArray } from "drizzle-orm";
import {
  AttendanceMarkError,
  markAttendance,
  patchAttendanceMark,
} from "../../services/attendance-mark";
import {
  SessionLifecycleError,
  checkInSession,
  checkOutSession,
  cancelSession,
} from "../../services/session-lifecycle";
import { todayIst } from "../../services/session-materialise";
import { loadSessionRoster } from "../../lib/session-roster";

const router: IRouter = Router();
router.use(requireAuth, requireAdminPanel);

const markBodySchema = z.object({
  submission_op_id: ulidSchema,
  marked_at: z.string().datetime({ offset: true }).or(z.string().datetime()),
  marks: z
    .array(
      z.object({
        student_id: z.string().uuid(),
        status: attendanceStatusSchema,
        notes: z.string().max(500).optional().nullable(),
        client_op_id: ulidSchema,
      }),
    )
    .min(1)
    .superRefine((marks, ctx) => {
      const seen = new Set<string>();
      const dupes = new Set<string>();
      for (const m of marks) {
        if (seen.has(m.student_id)) dupes.add(m.student_id);
        else seen.add(m.student_id);
      }
      if (dupes.size > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate student_id in marks: ${[...dupes].join(", ")}`,
        });
      }
    }),
});

const patchBodySchema = z.object({
  status: attendanceStatusSchema,
  marked_at: z.string().datetime({ offset: true }).or(z.string().datetime()),
  notes: z.string().max(500).optional().nullable(),
  client_op_id: ulidSchema,
  submission_op_id: ulidSchema.optional(),
});

const checkInBodySchema = z.object({
  submission_op_id: ulidSchema,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().min(0).max(10_000),
  batch_id: z.string().uuid().optional(),
});

const checkOutBodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().min(0).max(10_000).optional(),
});

const cancelBodySchema = z.object({
  reason: z.string().min(10).max(500),
  force_cancel: z.boolean().optional(),
});

function handleMarkError(res: Response, err: unknown): boolean {
  if (err instanceof AttendanceMarkError) {
    fail(res, err.httpStatus, err.code, err.message);
    return true;
  }
  return false;
}

function handleLifecycleError(res: Response, err: unknown): boolean {
  if (err instanceof SessionLifecycleError) {
    fail(res, err.httpStatus, err.code, err.message);
    return true;
  }
  return false;
}

/* GET /v1/sessions/today — shikshak's sessions for today (IST), with AT4 roster */
router.get("/today", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const date = todayIst();
  const onlyId =
    typeof req.query.session_id === "string" && req.query.session_id.length > 0
      ? String(req.query.session_id)
      : null;

  let scopeFilter;
  if (scope.batchIds !== null) {
    scopeFilter = scope.batchIds.length === 0 ? sql`false` : inArray(sessions.batch_id, scope.batchIds);
  } else if (scope.centreIds !== null) {
    scopeFilter =
      scope.centreIds.length === 0 ? sql`false` : inArray(batches.centre_id, scope.centreIds);
  } else {
    scopeFilter = undefined;
  }

  const rows = await db
    .select({
      id: sessions.id,
      batch_id: sessions.batch_id,
      batch_name: batches.name,
      centre_name: centres.name,
      centre_id: batches.centre_id,
      scheduled_date: sessions.scheduled_date,
      scheduled_start_time: sessions.scheduled_start_time,
      scheduled_end_time: sessions.scheduled_end_time,
      status: sessions.status,
      topic: sessions.topic,
      gps_required: sessions.gps_required,
      unscheduled: sessions.unscheduled,
      gps_flagged: sessions.gps_flagged,
      check_in_at: sessions.check_in_at,
      check_out_at: sessions.check_out_at,
      has_gps: sql<boolean>`(${centres.lat} is not null and ${centres.lng} is not null)`,
      present_count: sql<number>`count(${attendance.id}) filter (where ${attendance.status} in ('present','late'))::int`,
      total_count: sql<number>`count(${attendance.id})::int`,
    })
    .from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .leftJoin(attendance, eq(attendance.session_id, sessions.id))
    .where(
      and(
        eq(sessions.scheduled_date, date),
        scopeFilter,
        onlyId ? eq(sessions.id, onlyId) : undefined,
      ),
    )
    .groupBy(sessions.id, batches.name, centres.name, batches.centre_id, centres.lat, centres.lng)
    .orderBy(desc(sessions.scheduled_start_time));

  const items = [];
  for (const row of rows) {
    const roster = await loadSessionRoster(row.id, row.scheduled_date, row.batch_id);
    items.push({ ...row, roster });
  }

  ok(res, { items, date }, { count: items.length });
});

/* POST /v1/sessions/:id/check-in */
router.post("/:id/check-in", async (req: Request, res: Response) => {
  const sessionId = String(req.params.id);
  let body: z.infer<typeof checkInBodySchema>;
  try {
    body = checkInBodySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid check-in payload.");
    return;
  }

  try {
    const row = await checkInSession({
      sessionId,
      actor: req.authUser!,
      submissionOpId: body.submission_op_id,
      lat: body.lat,
      lng: body.lng,
      accuracy_m: body.accuracy_m,
      batchId: body.batch_id,
    });
    ok(res, row);
  } catch (err) {
    if (handleLifecycleError(res, err)) return;
    throw err;
  }
});

/* POST /v1/sessions/:id/check-out */
router.post("/:id/check-out", async (req: Request, res: Response) => {
  const sessionId = String(req.params.id);
  let body: z.infer<typeof checkOutBodySchema>;
  try {
    body = checkOutBodySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid check-out payload.");
    return;
  }

  try {
    const row = await checkOutSession({
      sessionId,
      actor: req.authUser!,
      lat: body.lat,
      lng: body.lng,
      accuracy_m: body.accuracy_m,
    });
    ok(res, row);
  } catch (err) {
    if (handleLifecycleError(res, err)) return;
    throw err;
  }
});

/* POST /v1/sessions/:id/cancel */
router.post("/:id/cancel", async (req: Request, res: Response) => {
  const sessionId = String(req.params.id);
  let body: z.infer<typeof cancelBodySchema>;
  try {
    body = cancelBodySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid cancel payload (reason min 10 chars).");
    return;
  }

  try {
    const row = await cancelSession({
      sessionId,
      actor: req.authUser!,
      reason: body.reason,
      forceCancel: body.force_cancel === true,
    });
    ok(res, row);
  } catch (err) {
    if (handleLifecycleError(res, err)) return;
    throw err;
  }
});

/* POST /v1/sessions/:id/attendance — scope enforced in service (Q2/MSV pattern) */
router.post("/:id/attendance", async (req: Request, res: Response) => {
  const sessionId = String(req.params.id);
  let body: z.infer<typeof markBodySchema>;
  try {
    body = markBodySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid attendance payload.");
    return;
  }

  try {
    const result = await markAttendance({
      sessionId,
      userId: req.authUser!.id,
      actor: req.authUser!,
      markedAt: new Date(body.marked_at),
      submissionOpId: body.submission_op_id,
      marks: body.marks.map((m) => ({
        student_id: m.student_id,
        status: m.status,
        notes: m.notes ?? null,
        client_op_id: m.client_op_id,
      })),
    });
    ok(res, result);
  } catch (err) {
    if (handleMarkError(res, err)) return;
    throw err;
  }
});

/* PATCH /v1/sessions/:id/attendance/:student_id */
router.patch("/:id/attendance/:student_id", async (req: Request, res: Response) => {
  const sessionId = String(req.params.id);
  const studentId = String(req.params.student_id);
  let body: z.infer<typeof patchBodySchema>;
  try {
    body = patchBodySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid attendance patch.");
    return;
  }

  try {
    const result = await patchAttendanceMark({
      sessionId,
      studentId,
      userId: req.authUser!.id,
      actor: req.authUser!,
      markedAt: new Date(body.marked_at),
      status: body.status,
      notes: body.notes ?? null,
      client_op_id: body.client_op_id,
      submissionOpId: body.submission_op_id,
    });
    ok(res, result);
  } catch (err) {
    if (handleMarkError(res, err)) return;
    throw err;
  }
});

export default router;
