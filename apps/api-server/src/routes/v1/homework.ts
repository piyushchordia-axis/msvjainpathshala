/**
 * /v1/homework — homework assignments + submissions.
 *
 * Admin/shikshak (requireAdminPanel): create assignments for a batch (fanning
 * out one pending submission per target student), list assignments with
 * submission counts, view per-assignment submissions, and grade submissions
 * (approve/star -> punya award).
 *
 * Student/parent (requireAuth): list a student's homework, and submit a
 * submission_url (auto-marked late if past the due date). Ownership of the
 * student is verified on every persona action.
 *
 * Scope: every admin read/mutation is constrained by the caller's batch/centre
 * write scope (via the assignment's batch -> centre). Out-of-scope on a
 * detail/action is a 404; an out-of-scope batch on create is a 403.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, homework_assignments, homework_submissions, batches, centres, students, punya_balances } from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { httpUrl } from "../../lib/validation";
import { signUploadUrl } from "../../lib/file-tokens";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, inBatchWriteScope, type AdminScope } from "../../lib/scope";
import { awardPunya } from "../../lib/punya";
import { auditFromReq } from "../../lib/audit";
import { clampLimit, scopedCentreFilter } from "../../lib/route-helpers";

const router: IRouter = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Base punya points for an approved homework; starred gets a 20% bonus. */
const POINTS = 10;


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

/* ═══════════════════════════ Admin / shikshak ═══════════════════════════ */

const createAssignmentSchema = z.object({
  batch_id: z.string().uuid(),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  attachment_url: httpUrl(1000).optional(),
  is_msv: z.boolean().optional(),
  target_student_ids: z.array(z.string().uuid()).max(500).optional(),
});

/* POST /v1/homework/assignments — create an assignment + fan out submissions */
router.post("/assignments", requireAdminPanel, async (req: Request, res: Response) => {
  let body: z.infer<typeof createAssignmentSchema>;
  try {
    body = createAssignmentSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid assignment data.");
    return;
  }

  const scope = await resolveAdminScope(req.authUser!);
  const [batch] = await db
    .select({ id: batches.id, centre_id: batches.centre_id })
    .from(batches)
    .where(eq(batches.id, body.batch_id))
    .limit(1);
  if (!batch) {
    fail(res, 404, "ERR_NOT_FOUND", "Batch not found.");
    return;
  }
  if (!inBatchWriteScope(scope, batch.id, batch.centre_id)) {
    fail(res, 403, "ERR_FORBIDDEN", "Batch not in your scope.");
    return;
  }

  // Determine targets: explicit subset (each must be an active student in the
  // batch) or all active students of the batch.
  let targetIds: string[];
  if (body.target_student_ids && body.target_student_ids.length > 0) {
    const requested = Array.from(new Set(body.target_student_ids));
    const valid = await db
      .select({ id: students.id })
      .from(students)
      .where(
        and(
          inArray(students.id, requested),
          eq(students.batch_id, batch.id),
          eq(students.status, "active"),
        ),
      );
    if (valid.length !== requested.length) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "One or more target students are not active in this batch.");
      return;
    }
    targetIds = valid.map((r) => r.id);
  } else {
    const all = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.batch_id, batch.id), eq(students.status, "active")));
    targetIds = all.map((r) => r.id);
  }

  const [row] = await db
    .insert(homework_assignments)
    .values({
      batch_id: batch.id,
      title: body.title,
      description: body.description ?? null,
      due_date: body.due_date,
      attachment_url: body.attachment_url ?? null,
      is_msv: body.is_msv ?? false,
      target_student_ids: body.target_student_ids && body.target_student_ids.length > 0 ? targetIds : null,
      created_by: req.authUser!.id,
    })
    .returning({ id: homework_assignments.id });

  let submissionsCreated = 0;
  if (targetIds.length > 0) {
    await db.insert(homework_submissions).values(
      targetIds.map((sid) => ({ assignment_id: row.id, student_id: sid, status: "pending" as const })),
    );
    submissionsCreated = targetIds.length;
  }

  await auditFromReq(req, {
    action: "create",
    entityKind: "homework_assignment",
    entityId: row.id,
    summary: `Created homework "${body.title}" for ${submissionsCreated} student(s).`,
    metadata: { batch_id: batch.id, submissions_created: submissionsCreated },
  });

  ok(res, { id: row.id, submissions_created: submissionsCreated });
});

/* GET /v1/homework/assignments?batch_id=&limit= — scoped list + counts */
router.get("/assignments", requireAdminPanel, async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 50, 200);
  const centreFilter = scopedCentreFilter(scope, batches.centre_id);

  const filters = [isNull(homework_assignments.deleted_at), centreFilter];
  // Shikshak scope is batch-level: centre membership alone would leak every
  // assignment at their centre (including batches they do not teach).
  if (scope.batchIds !== null) {
    filters.push(
      scope.batchIds.length === 0
        ? sql`false`
        : inArray(homework_assignments.batch_id, scope.batchIds),
    );
  }
  const batchId = req.query.batch_id;
  if (typeof batchId === "string" && UUID_RE.test(batchId)) {
    filters.push(eq(homework_assignments.batch_id, batchId));
  }

  const rows = await db
    .select({
      id: homework_assignments.id,
      title: homework_assignments.title,
      due_date: homework_assignments.due_date,
      is_msv: homework_assignments.is_msv,
      batch_id: homework_assignments.batch_id,
      batch_name: batches.name,
      centre_name: centres.name,
      created_at: homework_assignments.created_at,
      total: sql<number>`count(${homework_submissions.id})::int`,
      submitted: sql<number>`count(${homework_submissions.id}) filter (where ${homework_submissions.status} in ('submitted','approved','starred','late'))::int`,
      graded: sql<number>`count(${homework_submissions.id}) filter (where ${homework_submissions.status} in ('approved','starred'))::int`,
    })
    .from(homework_assignments)
    .innerJoin(batches, eq(batches.id, homework_assignments.batch_id))
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .leftJoin(homework_submissions, eq(homework_submissions.assignment_id, homework_assignments.id))
    .where(and(...filters))
    .groupBy(homework_assignments.id, batches.name, centres.name)
    .orderBy(desc(homework_assignments.created_at))
    .limit(limit);

  const items = rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
  ok(res, { items }, { count: items.length });
});

/* GET /v1/homework/assignments/:id/submissions — scoped submission list */
router.get("/assignments/:id/submissions", requireAdminPanel, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const scope = await resolveAdminScope(req.authUser!);
  const [assignment] = await db
    .select({
      id: homework_assignments.id,
      batch_id: homework_assignments.batch_id,
      centre_id: batches.centre_id,
    })
    .from(homework_assignments)
    .innerJoin(batches, eq(batches.id, homework_assignments.batch_id))
    .where(and(eq(homework_assignments.id, id), isNull(homework_assignments.deleted_at)))
    .limit(1);
  if (!assignment || !inBatchWriteScope(scope, assignment.batch_id, assignment.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Assignment not found.");
    return;
  }

  const rows = await db
    .select({
      id: homework_submissions.id,
      student_id: homework_submissions.student_id,
      student_name: students.full_name,
      student_code: students.student_code,
      status: homework_submissions.status,
      submission_url: homework_submissions.submission_url,
      feedback_note: homework_submissions.feedback_note,
      late: homework_submissions.late,
      marked_at: homework_submissions.marked_at,
    })
    .from(homework_submissions)
    .innerJoin(students, eq(students.id, homework_submissions.student_id))
    .where(eq(homework_submissions.assignment_id, assignment.id))
    .orderBy(asc(students.full_name));

  const items = rows.map((r) => ({ ...r, submission_url: signUploadUrl(r.submission_url), marked_at: r.marked_at ? r.marked_at.toISOString() : null }));
  ok(res, { items }, { count: items.length });
});

const gradeSchema = z.object({
  status: z.enum(["approved", "starred"]),
  feedback_note: z.string().max(2000).optional(),
});

/* POST /v1/homework/submissions/:id/grade — grade + award punya */
router.post("/submissions/:id/grade", requireAdminPanel, async (req: Request, res: Response) => {
  let body: z.infer<typeof gradeSchema>;
  try {
    body = gradeSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid grade data.");
    return;
  }

  const id = String(req.params.id);
  const scope = await resolveAdminScope(req.authUser!);
  const [sub] = await db
    .select({
      id: homework_submissions.id,
      student_id: homework_submissions.student_id,
      status: homework_submissions.status,
      batch_id: homework_assignments.batch_id,
      centre_id: batches.centre_id,
    })
    .from(homework_submissions)
    .innerJoin(homework_assignments, eq(homework_assignments.id, homework_submissions.assignment_id))
    .innerJoin(batches, eq(batches.id, homework_assignments.batch_id))
    .where(and(eq(homework_submissions.id, id), isNull(homework_assignments.deleted_at)))
    .limit(1);
  if (!sub || !inBatchWriteScope(scope, sub.batch_id, sub.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Submission not found.");
    return;
  }

  // Idempotent on points: re-grading an already-graded submission updates only
  // the status/feedback metadata and never re-awards punya. Punya is awarded
  // exactly once, on the transition out of a not-yet-graded state.
  //
  // Claim + grade + award run in ONE transaction: the status UPDATE is
  // conditional (only fires on a not-yet-graded row) and we read whether it
  // actually claimed the row. Only the call that wins the claim awards punya,
  // so concurrent double-clicks can't double-award. If the award crashes after
  // the claim, the whole tx rolls back — the status reverts and a retry can
  // re-claim, so points are never permanently lost. awardPunya also carries a
  // submission-scoped idempotency key as belt-and-suspenders against replays.
  const points = body.status === "starred" ? Math.round(POINTS * 1.2) : POINTS;

  const result = await db.transaction(async (tx) => {
    // Compare-and-set: claim the submission for a fresh (points-awarding) grade
    // only if it is not already graded. `claimed` tells us whether THIS call is
    // the one that transitioned it out of a not-yet-graded state.
    const claimedRows = await tx
      .update(homework_submissions)
      .set({
        status: body.status,
        feedback_note: body.feedback_note ?? null,
        marked_by: req.authUser!.id,
        marked_at: new Date(),
      })
      .where(
        and(
          eq(homework_submissions.id, sub.id),
          sql`${homework_submissions.status} not in ('approved', 'starred')`,
        ),
      )
      .returning({ id: homework_submissions.id });
    const claimed = claimedRows.length > 0;

    if (!claimed) {
      // Already graded (or claimed by a concurrent request): update only the
      // status/feedback metadata, never re-award punya.
      await tx
        .update(homework_submissions)
        .set({
          status: body.status,
          feedback_note: body.feedback_note ?? null,
          marked_by: req.authUser!.id,
          marked_at: new Date(),
        })
        .where(eq(homework_submissions.id, sub.id));

      const [bal] = await tx
        .select({ total_points: punya_balances.total_points })
        .from(punya_balances)
        .where(eq(punya_balances.student_id, sub.student_id))
        .limit(1);
      return { claimed: false, total_points: bal?.total_points ?? 0 };
    }

    const award = await awardPunya(
      {
        studentId: sub.student_id,
        featureKey: "homework",
        points,
        note: body.status === "starred" ? "Homework starred" : "Homework approved",
        awardedBy: req.authUser!.id,
        idempotencyKey: `homework-grade:${sub.id}`,
      },
      tx,
    );
    return { claimed: true, total_points: award.total_points };
  });

  if (!result.claimed) {
    await auditFromReq(req, {
      action: "grade",
      entityKind: "homework_submission",
      entityId: sub.id,
      summary: `Re-graded homework submission as ${body.status} (no punya re-award).`,
      metadata: { status: body.status, points: 0, re_grade: true },
    });

    ok(res, { id: sub.id, status: body.status, total_points: result.total_points });
    return;
  }

  await auditFromReq(req, {
    action: "grade",
    entityKind: "homework_submission",
    entityId: sub.id,
    summary: `Graded homework submission as ${body.status} (+${points}).`,
    metadata: { status: body.status, points },
  });

  ok(res, { id: sub.id, status: body.status, total_points: result.total_points });
});

/* ═══════════════════════════ Student / parent ═══════════════════════════ */

/* GET /v1/homework/mine?student_id= — a student's homework feed */
router.get("/mine", async (req: Request, res: Response) => {
  const studentId = String(req.query.student_id ?? "");
  if (!UUID_RE.test(studentId) || !(await ownedStudentId(req, studentId))) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }
  const limit = clampLimit(req.query.limit, 50, 200);
  const rows = await db
    .select({
      id: homework_submissions.id,
      assignment_id: homework_assignments.id,
      title: homework_assignments.title,
      description: homework_assignments.description,
      due_date: homework_assignments.due_date,
      attachment_url: homework_assignments.attachment_url,
      is_msv: homework_assignments.is_msv,
      status: homework_submissions.status,
      submission_url: homework_submissions.submission_url,
      feedback_note: homework_submissions.feedback_note,
      late: homework_submissions.late,
    })
    .from(homework_submissions)
    .innerJoin(homework_assignments, eq(homework_assignments.id, homework_submissions.assignment_id))
    .where(
      and(
        eq(homework_submissions.student_id, studentId),
        isNull(homework_assignments.deleted_at),
      ),
    )
    .orderBy(desc(homework_assignments.due_date))
    .limit(limit);

  const items = rows.map((r) => ({
    ...r,
    attachment_url: signUploadUrl(r.attachment_url),
    submission_url: signUploadUrl(r.submission_url),
  }));
  ok(res, { items }, { count: items.length });
});

const submitSchema = z.object({
  submission_url: httpUrl(1000),
});

/* POST /v1/homework/submissions/:id/submit — student/parent uploads their work */
router.post("/submissions/:id/submit", async (req: Request, res: Response) => {
  let body: z.infer<typeof submitSchema>;
  try {
    body = submitSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid submission data.");
    return;
  }

  const id = String(req.params.id);
  const [sub] = await db
    .select({
      id: homework_submissions.id,
      student_id: homework_submissions.student_id,
      status: homework_submissions.status,
      due_date: homework_assignments.due_date,
    })
    .from(homework_submissions)
    .innerJoin(homework_assignments, eq(homework_assignments.id, homework_submissions.assignment_id))
    .where(and(eq(homework_submissions.id, id), isNull(homework_assignments.deleted_at)))
    .limit(1);
  if (!sub || !(await ownedStudentId(req, sub.student_id))) {
    fail(res, 404, "ERR_NOT_FOUND", "Submission not found.");
    return;
  }

  // A graded submission is locked: a student must not be able to overwrite it
  // and clobber the awarded grade. Not-yet-graded states may still re-submit.
  if (sub.status === "approved" || sub.status === "starred") {
    fail(res, 409, "ERR_CONFLICT", "Submission already graded.");
    return;
  }

  // due_date is a 'YYYY-MM-DD' string; compare against today (UTC date).
  const today = new Date().toISOString().slice(0, 10);
  const isLate = sub.due_date < today;
  const nextStatus = isLate ? ("late" as const) : ("submitted" as const);

  await db
    .update(homework_submissions)
    .set({ submission_url: body.submission_url, status: nextStatus, late: isLate })
    .where(eq(homework_submissions.id, sub.id));

  ok(res, { id: sub.id, status: nextStatus });
});

export default router;
