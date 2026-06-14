/**
 * /v1/niyam-submissions — student niyam submission + shikshak review.
 *
 * A parent/student submits a niyam for one of their students. If the niyam's
 * proof_type allows proof-less completion ("either" with no proof_url) the
 * submission is auto-approved, points are granted immediately and the streak
 * is updated. Otherwise it lands as "pending" and a shikshak (admin-panel
 * role) in the student's centre scope approves or rejects it later.
 *
 * The submit route requires only authentication (parent/student). The review
 * routes additionally require admin-panel access, applied per-route below.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, niyams, niyam_submissions, niyam_streaks, students } from "@workspace/db";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, type AdminScope } from "../../lib/scope";
import { awardPunya } from "../../lib/punya";

const router: IRouter = Router();
router.use(requireAuth);

/* ---- local helpers copy-pasted into every admin route file ---- */
function scopedCentreFilter(scope: AdminScope, column: PgColumn) {
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

/** Today's calendar date as YYYY-MM-DD in IST (Asia/Kolkata, UTC+5:30). */
function todayIstDate(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

/** Yesterday relative to a YYYY-MM-DD string, as YYYY-MM-DD. */
function previousDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Update (or create) the student's streak for a niyam on a given submission
 * date: continue the run if the last submission was the previous day, else
 * restart at 1; always bump the longest-streak high-water mark.
 */
async function bumpStreak(studentId: string, niyamId: string, submissionDate: string): Promise<void> {
  const [row] = await db
    .select({
      id: niyam_streaks.id,
      current_streak: niyam_streaks.current_streak,
      longest_streak: niyam_streaks.longest_streak,
      last_submission_date: niyam_streaks.last_submission_date,
    })
    .from(niyam_streaks)
    .where(and(eq(niyam_streaks.student_id, studentId), eq(niyam_streaks.niyam_id, niyamId)))
    .limit(1);

  if (!row) {
    await db.insert(niyam_streaks).values({
      student_id: studentId,
      niyam_id: niyamId,
      current_streak: 1,
      longest_streak: 1,
      last_submission_date: submissionDate,
    });
    return;
  }

  const continued = row.last_submission_date === previousDate(submissionDate);
  const sameDay = row.last_submission_date === submissionDate;
  const current = sameDay ? row.current_streak : continued ? row.current_streak + 1 : 1;
  const longest = Math.max(row.longest_streak, current);
  await db
    .update(niyam_streaks)
    .set({ current_streak: current, longest_streak: longest, last_submission_date: submissionDate })
    .where(eq(niyam_streaks.id, row.id));
}

/* ---- route-local create schema (inline, NOT in api-zod) ---- */
const createSubmissionSchema = z.object({
  niyam_id: z.string().uuid(),
  student_id: z.string().uuid(),
  submission_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  proof_url: z.string().url().max(2000).optional(),
  notes: z.string().max(500).optional(),
});

/* POST /v1/niyam-submissions — student/parent submits a niyam */
router.post("/", async (req: Request, res: Response) => {
  let body: z.infer<typeof createSubmissionSchema>;
  try { body = createSubmissionSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid submission data."); return; }

  if (!(await ownedStudentId(req, body.student_id))) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found."); return;
  }

  const [niyam] = await db
    .select({ id: niyams.id, proof_type: niyams.proof_type, points: niyams.points })
    .from(niyams)
    .where(and(eq(niyams.id, body.niyam_id), eq(niyams.is_active, true)))
    .limit(1);
  if (!niyam) {
    fail(res, 404, "ERR_NOT_FOUND", "Niyam not found."); return;
  }

  const today = todayIstDate();
  const submissionDate = body.submission_date ?? today;

  // submission_date is client-controlled: bound it server-side to prevent
  // backdated/future point+streak farming. Allow only today or yesterday.
  if (submissionDate > today) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "submission_date cannot be in the future."); return;
  }
  if (submissionDate < previousDate(today)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "submission_date too old."); return;
  }

  const proofUrl = body.proof_url ?? null;

  if ((niyam.proof_type === "photo" || niyam.proof_type === "video") && !proofUrl) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Proof required."); return;
  }

  const [dup] = await db
    .select({ id: niyam_submissions.id })
    .from(niyam_submissions)
    .where(
      and(
        eq(niyam_submissions.niyam_id, niyam.id),
        eq(niyam_submissions.student_id, body.student_id),
        eq(niyam_submissions.submission_date, submissionDate),
        // Ignore rejected rows so a rejected submission can be re-submitted for
        // this date; still blocks pending/approved/auto_approved duplicates.
        ne(niyam_submissions.status, "rejected"),
      ),
    )
    .limit(1);
  if (dup) {
    fail(res, 409, "ERR_DUPLICATE", "Already submitted for this date."); return;
  }

  // With proof -> awaits shikshak review. Without proof (proof_type "either")
  // -> auto-approved, points granted now and streak updated.
  const autoApprove = !proofUrl;
  const status = autoApprove ? "auto_approved" : "pending";
  const pointsAwarded = autoApprove ? niyam.points : 0;

  const [row] = await db
    .insert(niyam_submissions)
    .values({
      niyam_id: niyam.id,
      student_id: body.student_id,
      submission_date: submissionDate,
      status,
      points_awarded: pointsAwarded,
      proof_url: proofUrl,
      notes: body.notes ?? null,
      submitted_by: req.authUser!.id,
    })
    .returning();

  if (autoApprove) {
    await awardPunya({
      studentId: body.student_id,
      featureKey: "niyam_submission",
      points: niyam.points,
      note: body.notes ?? null,
      awardedBy: req.authUser!.id,
    });
    await bumpStreak(body.student_id, niyam.id, submissionDate);
  }

  ok(res, {
    id: row.id,
    niyam_id: row.niyam_id,
    student_id: row.student_id,
    submission_date: row.submission_date,
    status: row.status,
    points_awarded: row.points_awarded,
    is_featured: row.is_featured,
    proof_url: row.proof_url,
    notes: row.notes,
    reviewed_at: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
  });
});

/* GET /v1/niyam-submissions/pending?limit= — pending submissions in scope */
router.get("/pending", requireAdminPanel, async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);
  const centreFilter = scopedCentreFilter(scope, students.centre_id);
  const rows = await db
    .select({
      id: niyam_submissions.id,
      student_id: niyam_submissions.student_id,
      student_name: students.full_name,
      student_code: students.student_code,
      niyam_id: niyam_submissions.niyam_id,
      niyam_title_en: niyams.title_en,
      niyam_title_hi: niyams.title_hi,
      proof_url: niyam_submissions.proof_url,
      notes: niyam_submissions.notes,
      submission_date: niyam_submissions.submission_date,
    })
    .from(niyam_submissions)
    .innerJoin(students, eq(students.id, niyam_submissions.student_id))
    .innerJoin(niyams, eq(niyams.id, niyam_submissions.niyam_id))
    .where(and(eq(niyam_submissions.status, "pending"), centreFilter))
    .orderBy(desc(niyam_submissions.submission_date))
    .limit(limit);
  ok(res, { items: rows }, { count: rows.length });
});

const rejectSchema = z.object({
  reason: z.string().max(300).optional(),
});

/* POST /v1/niyam-submissions/:id/approve — shikshak approves a pending submission */
router.post("/:id/approve", requireAdminPanel, async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const [sub] = await db
    .select({
      id: niyam_submissions.id,
      status: niyam_submissions.status,
      student_id: niyam_submissions.student_id,
      niyam_id: niyam_submissions.niyam_id,
      submission_date: niyam_submissions.submission_date,
      notes: niyam_submissions.notes,
      centre_id: students.centre_id,
      points: niyams.points,
    })
    .from(niyam_submissions)
    .innerJoin(students, eq(students.id, niyam_submissions.student_id))
    .innerJoin(niyams, eq(niyams.id, niyam_submissions.niyam_id))
    .where(eq(niyam_submissions.id, String(req.params.id)))
    .limit(1);
  if (!sub || !inScope(scope, sub.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Submission not found."); return;
  }

  // Atomic compare-and-set: only flip pending -> approved if it is STILL
  // pending, so two concurrent approvals can't both award. The award + streak
  // run only when this caller actually won the transition.
  const award = await db.transaction(async (tx) => {
    const updated = await tx
      .update(niyam_submissions)
      .set({
        status: "approved",
        points_awarded: sub.points,
        reviewed_by: req.authUser!.id,
        reviewed_at: new Date(),
      })
      .where(and(eq(niyam_submissions.id, sub.id), eq(niyam_submissions.status, "pending")))
      .returning({ id: niyam_submissions.id });
    if (updated.length === 0) return null;

    const result = await awardPunya({
      studentId: sub.student_id,
      featureKey: "niyam_submission",
      points: sub.points,
      note: sub.notes ?? null,
      awardedBy: req.authUser!.id,
    });
    await bumpStreak(sub.student_id, sub.niyam_id, sub.submission_date);
    return result;
  });

  if (!award) {
    fail(res, 409, "ERR_INVALID_STATE", "Submission is not pending."); return;
  }

  ok(res, { id: sub.id, status: "approved", total_points: award.total_points, tier: award.tier });
});

/* POST /v1/niyam-submissions/:id/reject — shikshak rejects a pending submission */
router.post("/:id/reject", requireAdminPanel, async (req: Request, res: Response) => {
  let body: z.infer<typeof rejectSchema>;
  try { body = rejectSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid reject payload."); return; }

  const scope = await resolveAdminScope(req.authUser!);
  const [sub] = await db
    .select({
      id: niyam_submissions.id,
      status: niyam_submissions.status,
      centre_id: students.centre_id,
    })
    .from(niyam_submissions)
    .innerJoin(students, eq(students.id, niyam_submissions.student_id))
    .where(eq(niyam_submissions.id, String(req.params.id)))
    .limit(1);
  if (!sub || !inScope(scope, sub.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Submission not found."); return;
  }

  // Atomic compare-and-set: reject only if it is still pending.
  const rejected = await db
    .update(niyam_submissions)
    .set({
      status: "rejected",
      notes: body.reason ?? null,
      reviewed_by: req.authUser!.id,
      reviewed_at: new Date(),
    })
    .where(and(eq(niyam_submissions.id, sub.id), eq(niyam_submissions.status, "pending")))
    .returning({ id: niyam_submissions.id });
  if (rejected.length === 0) {
    fail(res, 409, "ERR_INVALID_STATE", "Submission is not pending."); return;
  }

  ok(res, { id: sub.id, status: "rejected" });
});

export default router;
