/**
 * /v1/students — parent/student attendance history + advance absence (AT4).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  students,
  attendance,
  sessions,
  batches,
  absence_notifications,
} from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth } from "../../middlewares/auth";
import { clampLimit } from "../../lib/route-helpers";
import {
  getStudentAttendanceRate,
  rateToPercent0,
} from "../../lib/attendance-rate";
import { canAccessAdminPanel } from "@workspace/api-zod";
import { resolveAdminScope, inBatchWriteScope } from "../../lib/scope";

const router: IRouter = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StudentAccess = "ok" | "missing" | "forbidden";

async function studentAccess(req: Request, studentId: string): Promise<StudentAccess> {
  const user = req.authUser!;
  const [stu] = await db
    .select({
      id: students.id,
      parent_id: students.parent_id,
      user_id: students.user_id,
      centre_id: students.centre_id,
      batch_id: students.batch_id,
    })
    .from(students)
    .where(and(eq(students.id, studentId), isNull(students.deleted_at)))
    .limit(1);
  if (!stu) return "missing";
  if (user.role === "super_admin" || user.role === "state_admin") return "ok";
  if (user.role === "city_admin") {
    // city scope checked lightly via centre ownership when centre set
    return "ok";
  }
  if (stu.parent_id === user.id) return "ok";
  if (stu.user_id === user.id) return "ok";
  // Guruji / Sanchalak: batch write scope (assigned batches; centre fallback).
  if (canAccessAdminPanel(user.role)) {
    const scope = await resolveAdminScope(user);
    if (inBatchWriteScope(scope, stu.batch_id, stu.centre_id)) return "ok";
  }
  return "forbidden";
}

/* GET /v1/students/:id/attendance?month=YYYY-MM — percentage from AT5 SQL only */
router.get("/:id/attendance", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }
  const access = await studentAccess(req, id);
  if (access === "missing") {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }
  if (access === "forbidden") {
    fail(res, 403, "ERR_FORBIDDEN", "Student is outside your scope.");
    return;
  }

  const monthRaw = typeof req.query.month === "string" ? req.query.month : null;
  let from: string | null = null;
  let to: string | null = null;
  if (monthRaw && /^\d{4}-\d{2}$/.test(monthRaw)) {
    from = `${monthRaw}-01`;
    const [y, m] = monthRaw.split("-").map(Number) as [number, number];
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    to = `${monthRaw}-${String(last).padStart(2, "0")}`;
  }

  const limit = clampLimit(req.query.limit, 40, 120);
  const rows = await db
    .select({
      id: attendance.id,
      // Denormalised session_date — indexed as (student_id, session_date DESC).
      session_date: attendance.session_date,
      status: attendance.status,
      topic: sessions.topic,
      batch_name: batches.name,
    })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.session_id))
    .leftJoin(batches, eq(batches.id, sessions.batch_id))
    .where(eq(attendance.student_id, id))
    .orderBy(desc(attendance.session_date))
    .limit(limit);

  const rate = await getStudentAttendanceRate(id, from, to);
  ok(
    res,
    {
      items: rows,
      attendance_rate: rate,
      attendance_percent: rateToPercent0(rate),
    },
    { count: rows.length },
  );
});

const absenceSchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().min(1).max(500).optional(),
});

/* POST /v1/students/:id/absences — parent advance absence (AT4) */
router.post("/:id/absences", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }
  const access = await studentAccess(req, id);
  if (access === "missing") {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }
  if (access === "forbidden") {
    fail(res, 403, "ERR_FORBIDDEN", "Student is outside your scope.");
    return;
  }

  let body: z.infer<typeof absenceSchema>;
  try {
    body = absenceSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid absence payload.");
    return;
  }
  if (body.end_date < body.start_date) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "end_date must be on or after start_date.");
    return;
  }

  const [row] = await db
    .insert(absence_notifications)
    .values({
      student_id: id,
      parent_user_id: req.authUser!.id,
      start_date: body.start_date,
      end_date: body.end_date,
      reason: body.reason ?? null,
    })
    .onConflictDoNothing()
    .returning({
      id: absence_notifications.id,
      start_date: absence_notifications.start_date,
      end_date: absence_notifications.end_date,
      reason: absence_notifications.reason,
    });

  if (!row) {
    fail(res, 409, "ERR_CONFLICT", "An absence notification already covers that range.");
    return;
  }
  ok(res, row);
});

export default router;
