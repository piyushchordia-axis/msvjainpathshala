/**
 * /v1/me — persona-scoped reads for the mobile app.
 *
 * parent  : their own children + each child's punya / niyams / id-card
 * student : their own student record (same shapes, scoped to self)
 *
 * Attendance / today sessions use frozen routes under /v1/students and
 * /v1/sessions — no /me aliases.
 *
 * All routes require authentication. Student-scoped routes verify ownership
 * (the student belongs to the caller via parent_id or user_id) so a parent
 * can only read their own children and a student only their own record.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  users,
  students,
  centres,
  batches,
  punya_balances,
  punya_transactions,
  niyams,
  niyam_submissions,
  niyam_streaks,
  niyam_badges,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth } from "../../middlewares/auth";
import {
  periodKey,
  periodLabel,
  submittedPeriodTag,
  istCalendarDate,
} from "../../lib/niyam-period";
import { signUploadUrl, uploadKeyFromUrl } from "../../lib/file-tokens";
import { upsertIdCardArt } from "../../lib/idcard-render";
import { auditFromReq } from "../../lib/audit";
import { storage } from "../../lib/storage";
import { clampLimit, ownedStudentId } from "../../lib/route-helpers";
import { studentCanAccessNiyam } from "../../lib/niyam-audience";
import { toSessionUser } from "../../lib/session-user";
import { invalidateAuthUserCache } from "../../lib/auth-user-cache";

const router: IRouter = Router();

router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const userPhotoSchema = z.object({
  photo_url: z.string().min(1).max(1000).nullable(),
});

/**
 * PUT /v1/me/photo — set or clear the caller's profile avatar.
 * Accepts a previously uploaded /uploads URL (folder user-photos) or null to clear.
 */
router.put("/photo", async (req: Request, res: Response) => {
  let body: z.infer<typeof userPhotoSchema>;
  try {
    body = userPhotoSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "photo_url must be a URL string or null.");
    return;
  }

  if (body.photo_url !== null) {
    const key = uploadKeyFromUrl(body.photo_url);
    if (!key || !key.startsWith("user-photos/")) {
      fail(
        res,
        422,
        "ERR_VALIDATION_FAILED",
        "photo_url must be an uploaded file under user-photos.",
      );
      return;
    }
  }

  const uid = req.authUser!.id;
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, uid), isNull(users.deleted_at)))
    .limit(1);
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "User not found.");
    return;
  }

  const previousKey = row.photo_url ? uploadKeyFromUrl(row.photo_url) : null;

  const [updated] = await db
    .update(users)
    .set({ photo_url: body.photo_url, updated_at: new Date() })
    .where(eq(users.id, uid))
    .returning();

  if (previousKey && previousKey !== uploadKeyFromUrl(body.photo_url ?? "")) {
    await storage.remove(previousKey);
  }

  await invalidateAuthUserCache(uid);

  await auditFromReq(req, {
    action: "update",
    entityKind: "user",
    entityId: uid,
    summary: body.photo_url ? "Profile photo updated." : "Profile photo cleared.",
  });

  ok(res, { user: toSessionUser(updated!) });
});

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
      student_id: card.student_id,
      card_number: card.card_number,
      png_url: signUploadUrl(card.png_url),
      photo_url: signUploadUrl(body.photo_url),
      version_no: card.version_no,
      is_active: card.is_active,
      last_regenerated_at: card.last_regenerated_at,
    },
  });
});

/* Attendance history: use frozen GET /v1/students/:id/attendance (no /me alias). */

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

  const today = istCalendarDate();
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
      start_date: niyams.start_date,
      end_date: niyams.end_date,
    })
    .from(niyams)
    .where(
      and(
        eq(niyams.is_active, true),
        lte(niyams.start_date, today),
        or(isNull(niyams.end_date), gte(niyams.end_date, today)),
      ),
    )
    .orderBy(desc(niyams.points));

  const items = studentCtx
    ? rows.filter((n) =>
        studentCanAccessNiyam(
          {
            msv_audience: n.msv_audience,
            scope: n.scope,
            state_id: n.state_id,
            city_id: n.city_id,
          },
          studentCtx!,
        ),
      )
    : rows;

  // Current-period submission status in one query (no N+1).
  let periodByNiyam = new Map<
    string,
    { status: string; submission_date: string; period_key: string }
  >();
  if (studentId && items.length > 0) {
    const keys = items.map((n) => ({
      id: n.id,
      type: n.niyam_type as "daily" | "weekly" | "monthly",
      key: periodKey(n.niyam_type as "daily" | "weekly" | "monthly", today),
    }));
    const currentKeys = [...new Set(keys.map((k) => k.key))];
    const niyamIds = items.map((i) => i.id);
    const [subs, streakRows, badgeRows] = await Promise.all([
      db
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
        ),
      db
        .select({
          niyam_id: niyam_streaks.niyam_id,
          current_streak: niyam_streaks.current_streak,
          longest_streak: niyam_streaks.longest_streak,
        })
        .from(niyam_streaks)
        .where(
          and(eq(niyam_streaks.student_id, studentId), inArray(niyam_streaks.niyam_id, niyamIds)),
        ),
      db
        .select({
          niyam_id: niyam_badges.niyam_id,
          badge_key: niyam_badges.badge_key,
          streak_length: niyam_badges.streak_length,
          awarded_at: niyam_badges.awarded_at,
        })
        .from(niyam_badges)
        .where(
          and(eq(niyam_badges.student_id, studentId), inArray(niyam_badges.niyam_id, niyamIds)),
        ),
    ]);
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
    const streakByNiyam = new Map(streakRows.map((s) => [s.niyam_id, s]));

    const badgesByNiyam = new Map<string, typeof badgeRows>();
    for (const b of badgeRows) {
      const list = badgesByNiyam.get(b.niyam_id) ?? [];
      list.push(b);
      badgesByNiyam.set(b.niyam_id, list);
    }

    const enriched = items.map((n) => {
      const pKey = periodKey(n.niyam_type as "daily" | "weekly" | "monthly", today);
      const sub = periodByNiyam.get(n.id);
      const submitted = !!sub && sub.period_key === pKey;
      const streak = streakByNiyam.get(n.id);
      const earned = badgesByNiyam.get(n.id) ?? [];
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
        current_streak: streak?.current_streak ?? 0,
        longest_streak: streak?.longest_streak ?? 0,
        earned_badges: earned.map((b) => ({
          badge_key: b.badge_key,
          streak_length: b.streak_length,
          awarded_at: b.awarded_at.toISOString(),
        })),
      };
    });
    ok(res, { items: enriched }, { count: enriched.length });
    return;
  }

  ok(res, { items }, { count: items.length });
});

/* Shikshak today: use frozen GET /v1/sessions/today (no /me alias). */

export default router;
