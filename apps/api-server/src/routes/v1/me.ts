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
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth } from "../../middlewares/auth";
import { periodKey, periodLabel, submittedPeriodTag } from "../../lib/niyam-period";
import { signUploadUrl, uploadKeyFromUrl } from "../../lib/file-tokens";
import { upsertIdCardArt } from "../../lib/idcard-render";
import { auditFromReq } from "../../lib/audit";
import { storage } from "../../lib/storage";

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
    .where(and(eq(students.id, id), isNull(students.deleted_at), or(eq(students.parent_id, uid), eq(students.user_id, uid))))
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
      photo_url: students.photo_url,
      total_points: sql<number>`coalesce(${punya_balances.total_points}, 0)::int`,
      tier: sql<string>`coalesce(${punya_balances.tier}, 'jigyasu')`,
    })
    .from(students)
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .leftJoin(batches, eq(batches.id, students.batch_id))
    .leftJoin(punya_balances, eq(punya_balances.student_id, students.id))
    .where(and(isNull(students.deleted_at), or(eq(students.parent_id, uid), eq(students.user_id, uid))))
    .orderBy(students.full_name);

  ok(
    res,
    {
      items: rows.map((r) => ({
        ...r,
        photo_url: signUploadUrl(r.photo_url),
      })),
    },
    { count: rows.length },
  );
});

const studentPhotoSchema = z.object({
  photo_url: z.string().min(1).max(1000).nullable(),
});

/**
 * PUT /v1/me/students/:id/photo — parent/student sets the ID-card headshot.
 * Accepts a previously uploaded /uploads URL (folder student-photos) or null to clear.
 * Refreshes the digital ID card PNG without rotating the QR version.
 */
router.put("/students/:id/photo", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id) || !(await ownedStudentId(req, id))) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }

  let body: z.infer<typeof studentPhotoSchema>;
  try {
    body = studentPhotoSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "photo_url must be a URL string or null.");
    return;
  }

  if (body.photo_url !== null) {
    const key = uploadKeyFromUrl(body.photo_url);
    if (!key || !key.startsWith("student-photos/")) {
      fail(
        res,
        422,
        "ERR_VALIDATION_FAILED",
        "photo_url must be an uploaded file under student-photos.",
      );
      return;
    }
  }

  const [student] = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      student_code: students.student_code,
      msv_status: students.msv_status,
      photo_url: students.photo_url,
      centre_name: centres.name,
    })
    .from(students)
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .where(eq(students.id, id))
    .limit(1);
  if (!student) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }

  const previousKey = student.photo_url ? uploadKeyFromUrl(student.photo_url) : null;

  await db
    .update(students)
    .set({ photo_url: body.photo_url, updated_at: new Date() })
    .where(eq(students.id, id));

  const card = await upsertIdCardArt({
    studentId: id,
    fullName: student.full_name ?? student.student_code,
    studentCode: student.student_code,
    centreName: student.centre_name ?? "—",
    msvBadge: student.msv_status === "approved",
    photoUrl: body.photo_url,
    rotateQr: false,
  });

  if (previousKey && previousKey !== uploadKeyFromUrl(body.photo_url ?? "")) {
    await storage.remove(previousKey);
  }

  await auditFromReq(req, {
    action: "update",
    entityKind: "student",
    entityId: id,
    summary: body.photo_url ? "Student ID photo updated." : "Student ID photo cleared.",
  });

  ok(res, {
    student_id: id,
    photo_url: signUploadUrl(body.photo_url),
    id_card: {
      ...card,
      png_url: signUploadUrl(card.png_url),
    },
  });
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

/* GET /v1/me/niyam-catalog?student_id= — active niyams visible to this student */
router.get("/niyam-catalog", async (req: Request, res: Response) => {
  const studentIdRaw = req.query.student_id;
  const studentId = typeof studentIdRaw === "string" && UUID_RE.test(studentIdRaw) ? studentIdRaw : null;

  let studentCtx: {
    msv_status: string;
    city_id: string | null;
    state_id: string | null;
  } | null = null;

  if (studentId) {
    const uid = req.authUser!.id;
    const [owned] = await db
      .select({
        id: students.id,
        msv_status: students.msv_status,
        city_id: centres.city_id,
        state_id: centres.state_id,
      })
      .from(students)
      .leftJoin(centres, eq(centres.id, students.centre_id))
      .where(
        and(
          eq(students.id, studentId),
          isNull(students.deleted_at),
          or(eq(students.parent_id, uid), eq(students.user_id, uid)),
        ),
      )
      .limit(1);
    if (!owned) {
      fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
      return;
    }
    studentCtx = {
      msv_status: owned.msv_status,
      city_id: owned.city_id,
      state_id: owned.state_id,
    };
  }

  const rows = await db
    .select({
      id: niyams.id,
      title_en: niyams.title_en,
      title_hi: niyams.title_hi,
      description_en: niyams.description_en,
      description_hi: niyams.description_hi,
      niyam_type: niyams.niyam_type,
      proof_type: niyams.proof_type,
      proof_required: niyams.proof_required,
      approval_mode: niyams.approval_mode,
      max_uploads: niyams.max_uploads,
      points: niyams.points,
      scope: niyams.scope,
      state_id: niyams.state_id,
      city_id: niyams.city_id,
      msv_audience: niyams.msv_audience,
    })
    .from(niyams)
    .where(eq(niyams.is_active, true))
    .orderBy(desc(niyams.points));

  const items = studentCtx
    ? rows.filter((n) => {
        if (n.msv_audience === "msv" && studentCtx!.msv_status !== "approved") return false;
        if (n.msv_audience === "non_msv" && studentCtx!.msv_status === "approved") return false;
        if (n.scope === "national") return true;
        if (n.scope === "state") return !!n.state_id && n.state_id === studentCtx!.state_id;
        if (n.scope === "city") return !!n.city_id && n.city_id === studentCtx!.city_id;
        return false;
      })
    : rows;

  // Current-period submission status in one query (no N+1).
  let periodByNiyam = new Map<
    string,
    { status: string; submission_date: string; period_key: string }
  >();
  if (studentId && items.length > 0) {
    const today = (() => {
      const now = new Date();
      const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
      return ist.toISOString().slice(0, 10);
    })();
    const keys = items.map((n) => ({
      id: n.id,
      type: n.niyam_type as "daily" | "weekly" | "monthly",
      key: periodKey(n.niyam_type as "daily" | "weekly" | "monthly", today),
    }));
    const currentKeys = [...new Set(keys.map((k) => k.key))];
    const subs = await db
      .select({
        niyam_id: niyam_submissions.niyam_id,
        status: niyam_submissions.status,
        submission_date: niyam_submissions.submission_date,
        period_key: niyam_submissions.period_key,
      })
      .from(niyam_submissions)
      .where(
        and(
          eq(niyam_submissions.student_id, studentId),
          inArray(niyam_submissions.niyam_id, items.map((i) => i.id)),
          inArray(niyam_submissions.period_key, currentKeys),
          ne(niyam_submissions.status, "rejected"),
        ),
      );
    periodByNiyam = new Map(
      subs
        .filter((s) => s.period_key)
        .map((s) => [
          s.niyam_id,
          {
            status: s.status,
            submission_date: s.submission_date,
            period_key: s.period_key!,
          },
        ]),
    );

    const enriched = items.map((n) => {
      const pKey = periodKey(n.niyam_type as "daily" | "weekly" | "monthly", today);
      const sub = periodByNiyam.get(n.id);
      const submitted = !!sub && sub.period_key === pKey;
      return {
        ...n,
        current_period_key: pKey,
        period_label_en: periodLabel(n.niyam_type as "daily" | "weekly" | "monthly", pKey, "en"),
        period_label_hi: periodLabel(n.niyam_type as "daily" | "weekly" | "monthly", pKey, "hi"),
        submitted_this_period: submitted,
        submission_status: submitted ? sub!.status : null,
        submission_date: submitted ? sub!.submission_date : null,
        period_status_tag_en: submitted
          ? submittedPeriodTag(n.niyam_type as "daily" | "weekly" | "monthly", "en")
          : null,
        period_status_tag_hi: submitted
          ? submittedPeriodTag(n.niyam_type as "daily" | "weekly" | "monthly", "hi")
          : null,
      };
    });
    ok(res, { items: enriched }, { count: enriched.length });
    return;
  }

  ok(res, { items }, { count: items.length });
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
