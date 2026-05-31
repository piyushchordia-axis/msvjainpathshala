/**
 * /v1/me — persona-scoped reads for the mobile app.
 *
 * parent  : their own children + each child's attendance / punya / niyams
 * student : their own student record (same shapes, scoped to self)
 * shikshak: recent sessions for the batches they teach
 *
 * All routes require authentication. Student-scoped routes verify ownership
 * (the student belongs to the caller via parent_id or user_id) so a parent
 * can only read their own children and a student only their own record.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  students,
  centres,
  batches,
  sessions,
  attendance,
  punya_balances,
  punya_transactions,
  niyams,
  niyam_submissions,
  shikshak_batch_assignments,
} from "@workspace/db";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { ok, fail } from "../../lib/envelope";
import { requireAuth } from "../../middlewares/auth";

const router: IRouter = Router();

router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

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

/* GET /v1/me/children — students owned by the caller (parent: kids; student: self) */
router.get("/children", async (req: Request, res: Response) => {
  const uid = req.authUser!.id;
  const rows = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      student_code: students.student_code,
      age_group: students.age_group,
      centre_name: centres.name,
      batch_name: batches.name,
      msv_status: students.msv_status,
      status: students.status,
      total_points: sql<number>`coalesce(${punya_balances.total_points}, 0)::int`,
      tier: sql<string>`coalesce(${punya_balances.tier}, 'jigyasu')`,
    })
    .from(students)
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .leftJoin(batches, eq(batches.id, students.batch_id))
    .leftJoin(punya_balances, eq(punya_balances.student_id, students.id))
    .where(or(eq(students.parent_id, uid), eq(students.user_id, uid)))
    .orderBy(students.full_name);

  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/me/students/:id/attendance?limit= */
router.get("/students/:id/attendance", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id) || !(await ownedStudentId(req, id))) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }
  const limit = clampLimit(req.query.limit, 40, 120);
  const rows = await db
    .select({
      id: attendance.id,
      session_date: sessions.session_date,
      status: attendance.status,
      topic: sessions.topic,
      batch_name: batches.name,
    })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.session_id))
    .leftJoin(batches, eq(batches.id, sessions.batch_id))
    .where(eq(attendance.student_id, id))
    .orderBy(desc(sessions.session_date))
    .limit(limit);

  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/me/students/:id/punya — balance + recent transactions */
router.get("/students/:id/punya", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id) || !(await ownedStudentId(req, id))) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }
  const [balance] = await db
    .select({ total_points: punya_balances.total_points, tier: punya_balances.tier })
    .from(punya_balances)
    .where(eq(punya_balances.student_id, id))
    .limit(1);

  const txns = await db
    .select({
      id: punya_transactions.id,
      feature_key: punya_transactions.feature_key,
      points: punya_transactions.points,
      note: punya_transactions.note,
      created_at: punya_transactions.created_at,
    })
    .from(punya_transactions)
    .where(eq(punya_transactions.student_id, id))
    .orderBy(desc(punya_transactions.created_at))
    .limit(50);

  ok(res, {
    total_points: balance?.total_points ?? 0,
    tier: balance?.tier ?? "jigyasu",
    transactions: txns.map((t) => ({ ...t, created_at: t.created_at.toISOString() })),
  });
});

/* GET /v1/me/students/:id/niyams — recent niyam submissions */
router.get("/students/:id/niyams", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id) || !(await ownedStudentId(req, id))) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }
  const limit = clampLimit(req.query.limit, 40, 120);
  const rows = await db
    .select({
      id: niyam_submissions.id,
      niyam_title_en: niyams.title_en,
      niyam_title_hi: niyams.title_hi,
      niyam_type: niyams.niyam_type,
      submission_date: niyam_submissions.submission_date,
      status: niyam_submissions.status,
      points_awarded: niyam_submissions.points_awarded,
      is_featured: niyam_submissions.is_featured,
    })
    .from(niyam_submissions)
    .innerJoin(niyams, eq(niyams.id, niyam_submissions.niyam_id))
    .where(eq(niyam_submissions.student_id, id))
    .orderBy(desc(niyam_submissions.submission_date))
    .limit(limit);

  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/me/niyam-catalog — active niyam definitions (browse) */
router.get("/niyam-catalog", async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: niyams.id,
      title_en: niyams.title_en,
      title_hi: niyams.title_hi,
      description_en: niyams.description_en,
      description_hi: niyams.description_hi,
      niyam_type: niyams.niyam_type,
      points: niyams.points,
    })
    .from(niyams)
    .where(eq(niyams.is_active, true))
    .orderBy(desc(niyams.points));

  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/me/today — recent sessions for the batches a shikshak teaches */
router.get("/today", async (req: Request, res: Response) => {
  const uid = req.authUser!.id;
  const limit = clampLimit(req.query.limit, 30, 90);
  const rows = await db
    .select({
      id: sessions.id,
      session_date: sessions.session_date,
      status: sessions.status,
      topic: sessions.topic,
      batch_name: batches.name,
      centre_name: centres.name,
      present_count: sql<number>`count(${attendance.id}) filter (where ${attendance.status} in ('present','late'))::int`,
      total_count: sql<number>`count(${attendance.id})::int`,
    })
    .from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .innerJoin(
      shikshak_batch_assignments,
      and(
        eq(shikshak_batch_assignments.batch_id, batches.id),
        eq(shikshak_batch_assignments.user_id, uid),
        eq(shikshak_batch_assignments.is_active, true),
      ),
    )
    .leftJoin(centres, eq(centres.id, batches.centre_id))
    .leftJoin(attendance, eq(attendance.session_id, sessions.id))
    .groupBy(sessions.id, batches.name, centres.name)
    .orderBy(desc(sessions.session_date))
    .limit(limit);

  ok(res, { items: rows }, { count: rows.length });
});

export default router;
