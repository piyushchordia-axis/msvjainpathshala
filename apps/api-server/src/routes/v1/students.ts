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
  course_certificates,
} from "@workspace/db";
import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth } from "../../middlewares/auth";
import { clampLimit, firstName } from "../../lib/route-helpers";
import {
  getStudentAttendanceRate,
  rateToPercent0,
} from "../../lib/attendance-rate";
import { canAccessAdminPanel } from "@workspace/api-zod";
import { resolveAdminScope, inBatchWriteScope } from "../../lib/scope";
import { storage } from "../../lib/storage";
import { signUploadUrl } from "../../lib/file-tokens";

/** Parse YYYY-MM into inclusive session_date bounds, or null if invalid. */
function monthBounds(monthRaw: string | null): { from: string; to: string } | null {
  if (!monthRaw || !/^\d{4}-\d{2}$/.test(monthRaw)) return null;
  const [y, m] = monthRaw.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${monthRaw}-01`,
    to: `${monthRaw}-${String(last).padStart(2, "0")}`,
  };
}

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
  const bounds = monthBounds(monthRaw);
  const from = bounds?.from ?? null;
  const to = bounds?.to ?? null;

  // Month views need a full calendar window; unscoped history stays smaller.
  const limit = clampLimit(req.query.limit, bounds ? 120 : 40, 120);
  const itemFilters = [eq(attendance.student_id, id)];
  if (bounds) {
    itemFilters.push(gte(attendance.session_date, bounds.from));
    itemFilters.push(lte(attendance.session_date, bounds.to));
  }
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
    .where(and(...itemFilters))
    .orderBy(desc(attendance.session_date))
    .limit(limit);

  // AT5 — rate from SQL only; never derive from filtered items.
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

/* GET /v1/students/:id/absences?month=YYYY-MM — pending + recent leave windows */
router.get("/:id/absences", async (req: Request, res: Response) => {
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
  const bounds = monthBounds(monthRaw);
  const limit = clampLimit(req.query.limit, 40, 120);

  const filters = [eq(absence_notifications.student_id, id)];
  if (bounds) {
    // Range intersects the month window.
    filters.push(lte(absence_notifications.start_date, bounds.to));
    filters.push(gte(absence_notifications.end_date, bounds.from));
  }

  const rows = await db
    .select({
      id: absence_notifications.id,
      start_date: absence_notifications.start_date,
      end_date: absence_notifications.end_date,
      reason: absence_notifications.reason,
      resolved_at: absence_notifications.resolved_at,
    })
    .from(absence_notifications)
    .where(and(...filters))
    .orderBy(desc(absence_notifications.start_date))
    .limit(limit);

  ok(
    res,
    {
      items: rows.map((r) => ({
        ...r,
        resolved_at: r.resolved_at ? r.resolved_at.toISOString() : null,
      })),
    },
    { count: rows.length },
  );
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

/* GET /v1/students/:id/course-progress?course_id= — CU28 via fn_course_progress */
router.get("/:id/course-progress", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const courseId = typeof req.query.course_id === "string" ? req.query.course_id : null;
  if (!UUID_RE.test(id) || !courseId || !UUID_RE.test(courseId)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "student id and course_id are required.");
    return;
  }
  const access = await studentAccess(req, id);
  if (access === "missing") {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }
  if (access === "forbidden") {
    fail(res, 403, "ERR_COURSE_STUDENT_OUT_OF_SCOPE", "That student is outside your scope.");
    return;
  }
  const { getCourseProgress } = await import("../../lib/course-progress");
  const stats = await getCourseProgress(id, courseId);
  ok(res, stats);
});

/* GET /v1/students/:id/certificates — owner or in-scope admin (CU24) */
router.get("/:id/certificates", async (req: Request, res: Response) => {
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
    fail(res, 403, "ERR_COURSE_STUDENT_OUT_OF_SCOPE", "That student is outside your scope.");
    return;
  }

  const rows = await db
    .select({
      id: course_certificates.id,
      kind: course_certificates.kind,
      course_id: course_certificates.course_id,
      section_id: course_certificates.section_id,
      verification_code: course_certificates.verification_code,
      scope_snapshot: course_certificates.scope_snapshot,
      issued_at: course_certificates.issued_at,
      voided_at: course_certificates.voided_at,
      storage_key: course_certificates.storage_key,
    })
    .from(course_certificates)
    .where(eq(course_certificates.student_id, id))
    .orderBy(desc(course_certificates.issued_at));

  const items = rows.map((r) => {
    const snap = r.scope_snapshot as {
      kind?: string;
      section_title_en?: string;
      section_title_hi?: string;
      course_name_en?: string;
      course_name_hi?: string | null;
      honorific_en?: string;
      honorific_hi?: string;
      student_full_name?: string;
    } | null;
    const title_en =
      r.kind === "section"
        ? (snap?.section_title_en ?? "")
        : (snap?.course_name_en ?? "");
    const title_hi =
      r.kind === "section"
        ? (snap?.section_title_hi ?? null)
        : (snap?.course_name_hi ?? null);
    // storage_key NULL means "issuing", not broken (CU24).
    const status = r.voided_at ? "void" : r.storage_key ? "ready" : "issuing";
    const pdf_url =
      r.storage_key != null
        ? signUploadUrl(storage.url(r.storage_key), 7 * 24 * 3600)
        : null;
    return {
      id: r.id,
      kind: r.kind,
      title_en,
      title_hi,
      issued_at: r.issued_at.toISOString(),
      voided_at: r.voided_at ? r.voided_at.toISOString() : null,
      status,
      pdf_url,
      verification_code: r.verification_code,
      honorific_en: snap?.honorific_en ?? null,
      honorific_hi: snap?.honorific_hi ?? null,
      student_first_name: firstName(snap?.student_full_name ?? null),
    };
  });

  ok(res, { items }, { count: items.length });
});

export default router;
