/**
 * /v1/exams — full online exams: question/option authoring (admin), the student
 * take flow (available → start → autosave answers → submit → result), and
 * auto + manual grading.
 *
 * Exams are CITY-scoped. Admin authoring/grading routes require city_admin+
 * (canAdministerExams — narrower than canAccessAdminPanel; SPEC 6.17) and
 * verify the exam's city is in the caller's city scope (404 out of scope).
 * Student take-flow routes accept parent or student (SPEC 6.17 student-view):
 * resolveStudentContext uses ownedStudentsCondition (parent_id / user_id, Q11).
 * Incremental PUT answers upsert without grading (SPEC §6.17 answer).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  online_exams,
  exam_questions,
  exam_question_options,
  exam_attempts,
  exam_answers,
  students,
  centres,
  cities,
  type User,
} from "@workspace/db";
import { and, asc, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { canAdministerExams } from "@workspace/api-zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth } from "../../middlewares/auth";
import { resolveAdminScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import { rateLimit } from "../../lib/ratelimit";
import { timingSafeEqualString, verifyOtpCode } from "../../lib/tokens";
import { ownedStudentsCondition } from "../../lib/route-helpers";
import { isUuid } from "../../lib/validation";
import { resolveExamCompletionPoints } from "../../lib/exam-points";
import { awardExamCompletionPunya } from "../../lib/exam-punya";

/** Re-export for callers that historically imported abandon from the route module. */
export { runExamAttemptAbandon } from "../../lib/exam-attempt-abandon";

const router: IRouter = Router();
router.use(requireAuth);

/**
 * True if ANY exam_attempts row exists for this exam (including abandoned).
 * Used to lock question authoring once students have started — editing would
 * change scores mid-flight; admins should clone instead.
 */
async function examHasAttempts(examId: string): Promise<boolean> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(exam_attempts)
    .where(eq(exam_attempts.exam_id, examId));
  return Number(n ?? 0) > 0;
}

/* ---- city scope: null = all (super_admin); [] = nothing; else city ids ---- */
async function cityScopeForUser(user: User): Promise<string[] | null> {
  if (user.role === "super_admin") return null;
  if (user.role === "city_admin") return user.city_id ? [user.city_id] : [];
  if (user.role === "state_admin") {
    if (!user.state_id) return [];
    const rows = await db
      .select({ id: cities.id })
      .from(cities)
      .where(eq(cities.state_id, user.state_id));
    return rows.map((r) => r.id);
  }
  const scope = await resolveAdminScope(user);
  if (scope.centreIds === null) return null;
  if (scope.centreIds.length === 0) return [];
  const rows = await db
    .select({ city_id: centres.city_id })
    .from(centres)
    .where(inArray(centres.id, scope.centreIds));
  return Array.from(new Set(rows.map((r) => r.city_id)));
}

function cityInScope(cityIds: string[] | null, cityId: string | null): boolean {
  if (cityIds === null) return true;
  if (!cityId) return false;
  return cityIds.includes(cityId);
}

/** The city of a student via their centre, or null. */
async function cityForStudent(centreId: string | null): Promise<string | null> {
  if (!centreId) return null;
  const [row] = await db
    .select({ city_id: centres.city_id })
    .from(centres)
    .where(eq(centres.id, centreId))
    .limit(1);
  return row?.city_id ?? null;
}

/** Compare two id sets for equality, order-independent. */
function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i += 1) if (sa[i] !== sb[i]) return false;
  return true;
}

/**
 * Ensure every selected_option_id belongs to its claimed question_id.
 * One query over exam_question_options for all pairs — no per-question loop.
 */
async function assertOptionsBelongToQuestions(
  pairs: Array<{ question_id: string; selected_option_ids: string[] }>,
): Promise<{ ok: true } | { ok: false; question_id: string }> {
  const nonEmpty = pairs.filter((p) => p.selected_option_ids.length > 0);
  if (nonEmpty.length === 0) return { ok: true };

  const allOptionIds = [...new Set(nonEmpty.flatMap((p) => p.selected_option_ids))];
  const rows = await db
    .select({
      id: exam_question_options.id,
      question_id: exam_question_options.question_id,
    })
    .from(exam_question_options)
    .where(inArray(exam_question_options.id, allOptionIds));

  const questionByOption = new Map(rows.map((r) => [r.id, r.question_id]));
  for (const pair of nonEmpty) {
    for (const optionId of pair.selected_option_ids) {
      if (questionByOption.get(optionId) !== pair.question_id) {
        return { ok: false, question_id: pair.question_id };
      }
    }
  }
  return { ok: true };
}

/* ═══════════════════════════ ADMIN — authoring ═══════════════════════════ */

/* GET /v1/exams/:id/questions — admin view (includes is_correct) */
router.get("/:id/questions", async (req: Request, res: Response) => {
  if (!canAdministerExams(req.authUser?.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only city admins and above can administer exams.");
    return;
  }
  const cityIds = await cityScopeForUser(req.authUser!);
  const examId = String(req.params.id);
  const [exam] = await db
    .select({ id: online_exams.id, city_id: online_exams.city_id })
    .from(online_exams)
    .where(eq(online_exams.id, examId))
    .limit(1);
  if (!exam || !cityInScope(cityIds, exam.city_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
    return;
  }

  const questions = await db
    .select({
      id: exam_questions.id,
      question_en: exam_questions.question_en,
      question_hi: exam_questions.question_hi,
      question_type: exam_questions.question_type,
      marks: exam_questions.marks,
      order_index: exam_questions.order_index,
    })
    .from(exam_questions)
    .where(eq(exam_questions.exam_id, examId))
    .orderBy(asc(exam_questions.order_index), asc(exam_questions.created_at));

  const ids = questions.map((q) => q.id);
  const options = ids.length
    ? await db
        .select({
          id: exam_question_options.id,
          question_id: exam_question_options.question_id,
          option_en: exam_question_options.option_en,
          option_hi: exam_question_options.option_hi,
          is_correct: exam_question_options.is_correct,
          order_index: exam_question_options.order_index,
        })
        .from(exam_question_options)
        .where(inArray(exam_question_options.question_id, ids))
        .orderBy(asc(exam_question_options.order_index), asc(exam_question_options.created_at))
    : [];

  const items = questions.map((q) => ({
    ...q,
    options: options.filter((o) => o.question_id === q.id),
  }));
  ok(res, { items }, { count: items.length });
});

const createQuestionSchema = z.object({
  question_en: z.string().min(1).max(2000),
  question_hi: z.string().max(2000).optional(),
  question_type: z.enum(["single_choice", "multi_choice", "text"]),
  marks: z.coerce.number().int().min(1).max(100),
  options: z
    .array(
      z.object({
        option_en: z.string().min(1).max(1000),
        option_hi: z.string().max(1000).optional(),
        is_correct: z.boolean().default(false),
      }),
    )
    .optional(),
});

/* POST /v1/exams/:id/questions — add a question (+ options) */
router.post("/:id/questions", async (req: Request, res: Response) => {
  if (!canAdministerExams(req.authUser?.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only city admins and above can administer exams.");
    return;
  }
  let body: z.infer<typeof createQuestionSchema>;
  try {
    body = createQuestionSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid question data.");
    return;
  }

  const cityIds = await cityScopeForUser(req.authUser!);
  const examId = String(req.params.id);
  const [exam] = await db
    .select({ id: online_exams.id, city_id: online_exams.city_id })
    .from(online_exams)
    .where(eq(online_exams.id, examId))
    .limit(1);
  if (!exam || !cityInScope(cityIds, exam.city_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
    return;
  }

  if (await examHasAttempts(examId)) {
    fail(
      res,
      409,
      "ERR_EXAM_HAS_ATTEMPTS",
      "Students have already attempted this exam — editing questions now would change their scores. Clone the exam instead.",
    );
    return;
  }

  const opts = body.options ?? [];
  if (body.question_type === "text") {
    if (opts.length > 0) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Text questions must not have options.");
      return;
    }
  } else {
    if (opts.length < 2) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Choice questions need at least two options.");
      return;
    }
    const correct = opts.filter((o) => o.is_correct).length;
    if (body.question_type === "single_choice" && correct !== 1) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Single-choice questions need exactly one correct option.");
      return;
    }
    if (body.question_type === "multi_choice" && correct < 1) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Multi-choice questions need at least one correct option.");
      return;
    }
  }

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${exam_questions.order_index}), -1)::int` })
    .from(exam_questions)
    .where(eq(exam_questions.exam_id, examId));

  const [question] = await db
    .insert(exam_questions)
    .values({
      exam_id: examId,
      question_en: body.question_en,
      question_hi: body.question_hi ?? null,
      question_type: body.question_type,
      marks: body.marks,
      order_index: (max ?? -1) + 1,
    })
    .returning({ id: exam_questions.id });

  if (opts.length > 0) {
    await db.insert(exam_question_options).values(
      opts.map((o, i) => ({
        question_id: question.id,
        option_en: o.option_en,
        option_hi: o.option_hi ?? null,
        is_correct: o.is_correct,
        order_index: i,
      })),
    );
  }

  await auditFromReq(req, {
    action: "create",
    entityKind: "exam_question",
    entityId: question.id,
    summary: `Added ${body.question_type} question to exam.`,
    metadata: { exam_id: examId, question_type: body.question_type, marks: body.marks },
  });

  ok(res, { id: question.id });
});

/* DELETE /v1/exams/:id/questions/:qid — remove a question (options cascade) */
router.delete("/:id/questions/:qid", async (req: Request, res: Response) => {
  if (!canAdministerExams(req.authUser?.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only city admins and above can administer exams.");
    return;
  }
  const cityIds = await cityScopeForUser(req.authUser!);
  const examId = String(req.params.id);
  const qid = String(req.params.qid);
  const [exam] = await db
    .select({ id: online_exams.id, city_id: online_exams.city_id })
    .from(online_exams)
    .where(eq(online_exams.id, examId))
    .limit(1);
  if (!exam || !cityInScope(cityIds, exam.city_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
    return;
  }

  if (await examHasAttempts(examId)) {
    fail(
      res,
      409,
      "ERR_EXAM_HAS_ATTEMPTS",
      "Students have already attempted this exam — editing questions now would change their scores. Clone the exam instead.",
    );
    return;
  }

  const [question] = await db
    .select({ id: exam_questions.id })
    .from(exam_questions)
    .where(and(eq(exam_questions.id, qid), eq(exam_questions.exam_id, examId)))
    .limit(1);
  if (!question) {
    fail(res, 404, "ERR_NOT_FOUND", "Question not found.");
    return;
  }
  await db.delete(exam_questions).where(eq(exam_questions.id, qid));

  await auditFromReq(req, {
    action: "delete",
    entityKind: "exam_question",
    entityId: qid,
    summary: "Deleted exam question.",
    metadata: { exam_id: examId },
  });

  ok(res, { id: qid, deleted: true });
});

/* ═══════════════════════════ ADMIN — grading ═══════════════════════════ */

/* GET /v1/exams/:id/attempts/:attemptId — attempt detail with answers joined */
router.get("/:id/attempts/:attemptId", async (req: Request, res: Response) => {
  if (!canAdministerExams(req.authUser?.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only city admins and above can administer exams.");
    return;
  }
  const cityIds = await cityScopeForUser(req.authUser!);
  const examId = String(req.params.id);
  const attemptId = String(req.params.attemptId);
  const [exam] = await db
    .select({ id: online_exams.id, city_id: online_exams.city_id })
    .from(online_exams)
    .where(eq(online_exams.id, examId))
    .limit(1);
  if (!exam || !cityInScope(cityIds, exam.city_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
    return;
  }

  const [attempt] = await db
    .select({
      id: exam_attempts.id,
      exam_id: exam_attempts.exam_id,
      student_id: exam_attempts.student_id,
      student_name: students.full_name,
      student_code: students.student_code,
      started_at: exam_attempts.started_at,
      submitted_at: exam_attempts.submitted_at,
      score: exam_attempts.score,
      auto_score: exam_attempts.auto_score,
      manual_score: exam_attempts.manual_score,
      needs_grading: exam_attempts.needs_grading,
      status: exam_attempts.status,
    })
    .from(exam_attempts)
    .innerJoin(students, eq(students.id, exam_attempts.student_id))
    .where(and(eq(exam_attempts.id, attemptId), eq(exam_attempts.exam_id, examId)))
    .limit(1);
  if (!attempt) {
    fail(res, 404, "ERR_NOT_FOUND", "Attempt not found.");
    return;
  }

  const answers = await db
    .select({
      question_id: exam_questions.id,
      question_en: exam_questions.question_en,
      question_hi: exam_questions.question_hi,
      question_type: exam_questions.question_type,
      marks: exam_questions.marks,
      order_index: exam_questions.order_index,
      answer_id: exam_answers.id,
      selected_option_ids: exam_answers.selected_option_ids,
      text_answer: exam_answers.text_answer,
      is_correct: exam_answers.is_correct,
      marks_awarded: exam_answers.marks_awarded,
      admin_comment: exam_answers.admin_comment,
    })
    .from(exam_questions)
    .leftJoin(
      exam_answers,
      and(eq(exam_answers.question_id, exam_questions.id), eq(exam_answers.attempt_id, attemptId)),
    )
    .where(eq(exam_questions.exam_id, examId))
    .orderBy(asc(exam_questions.order_index), asc(exam_questions.created_at));

  ok(res, {
    ...attempt,
    started_at: attempt.started_at.toISOString(),
    submitted_at: attempt.submitted_at ? attempt.submitted_at.toISOString() : null,
    answers: answers.map((a) => ({
      question_id: a.question_id,
      question_en: a.question_en,
      question_hi: a.question_hi,
      question_type: a.question_type,
      marks: a.marks,
      selected_option_ids: a.selected_option_ids ?? [],
      text_answer: a.text_answer,
      is_correct: a.is_correct,
      marks_awarded: a.marks_awarded,
      admin_comment: a.admin_comment,
    })),
  });
});

const gradeSchema = z.object({
  grades: z
    .array(
      z.object({
        question_id: z.string().uuid(),
        marks_awarded: z.coerce.number().int().min(0),
        admin_comment: z.string().max(2000).optional(),
      }),
    )
    .min(1),
});

/* POST /v1/exams/:id/attempts/:attemptId/grade — manual grade text answers */
router.post("/:id/attempts/:attemptId/grade", async (req: Request, res: Response) => {
  if (!canAdministerExams(req.authUser?.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only city admins and above can administer exams.");
    return;
  }
  let body: z.infer<typeof gradeSchema>;
  try {
    body = gradeSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid grade payload.");
    return;
  }

  const cityIds = await cityScopeForUser(req.authUser!);
  const examId = String(req.params.id);
  const attemptId = String(req.params.attemptId);
  const [exam] = await db
    .select({
      id: online_exams.id,
      city_id: online_exams.city_id,
      pass_mark: online_exams.pass_mark,
      completion_points: online_exams.completion_points,
    })
    .from(online_exams)
    .where(eq(online_exams.id, examId))
    .limit(1);
  if (!exam || !cityInScope(cityIds, exam.city_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
    return;
  }

  const [attempt] = await db
    .select({
      id: exam_attempts.id,
      auto_score: exam_attempts.auto_score,
      status: exam_attempts.status,
      student_id: exam_attempts.student_id,
    })
    .from(exam_attempts)
    .where(and(eq(exam_attempts.id, attemptId), eq(exam_attempts.exam_id, examId)))
    .limit(1);
  if (!attempt) {
    fail(res, 404, "ERR_NOT_FOUND", "Attempt not found.");
    return;
  }
  if (attempt.status === "in_progress") {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Attempt not submitted.");
    return;
  }

  // Resolve Punya points before the grading transaction (avoid a second pool
  // connection while holding the advisory lock).
  const completionPoints = await resolveExamCompletionPoints(
    exam.city_id,
    exam.completion_points,
  );
  const passMark = exam.pass_mark;

  // Text questions for this exam, with their max marks.
  const textQuestions = await db
    .select({ id: exam_questions.id, marks: exam_questions.marks })
    .from(exam_questions)
    .where(and(eq(exam_questions.exam_id, examId), eq(exam_questions.question_type, "text")));
  const textMax = new Map(textQuestions.map((q) => [q.id, q.marks]));

  // Clamp awards in memory so the transaction only writes.
  const gradeUpdates: Array<{
    question_id: string;
    marks_awarded: number;
    is_correct: boolean;
    admin_comment: string | null;
  }> = [];
  for (const g of body.grades) {
    const max = textMax.get(g.question_id);
    if (max === undefined) continue; // only text questions are gradable
    const awarded = Math.max(0, Math.min(g.marks_awarded, max));
    gradeUpdates.push({
      question_id: g.question_id,
      marks_awarded: awarded,
      is_correct: awarded > 0,
      admin_comment: g.admin_comment?.trim() ? g.admin_comment.trim() : null,
    });
  }

  const graderId = req.authUser!.id;
  const gradedAt = new Date();
  const textIds = textQuestions.map((q) => q.id);

  // Atomically apply marks, recompute manual_score / ungraded, and finalize the
  // attempt. Under READ COMMITTED two concurrent graders would otherwise
  // interleave per-answer UPDATEs with a stale ungraded count and leave
  // needs_grading / score wrong — serialize per attempt with a transaction-
  // scoped advisory lock (same pattern as POST /:id/start).
  const gradeResult = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${attemptId}, 0))`);

    if (gradeUpdates.length > 0) {
      const valueRows = gradeUpdates.map(
        (g) =>
          sql`(${g.question_id}::uuid, ${g.marks_awarded}::int, ${g.is_correct}::boolean, ${g.admin_comment}::text, ${graderId}::uuid)`,
      );
      await tx.execute(sql`
        UPDATE exam_answers AS ea
        SET
          marks_awarded = v.marks_awarded,
          is_correct = v.is_correct,
          admin_comment = v.admin_comment,
          graded_by_user_id = v.graded_by_user_id
        FROM (VALUES ${sql.join(valueRows, sql`, `)}) AS v(question_id, marks_awarded, is_correct, admin_comment, graded_by_user_id)
        WHERE ea.attempt_id = ${attemptId}::uuid
          AND ea.question_id = v.question_id
      `);
    }

    let manualScore = 0;
    let ungraded = 0;
    if (textIds.length > 0) {
      const graded = await tx
        .select({ marks_awarded: exam_answers.marks_awarded })
        .from(exam_answers)
        .where(
          and(
            eq(exam_answers.attempt_id, attemptId),
            inArray(exam_answers.question_id, textIds),
          ),
        );
      manualScore = graded.reduce((sum, r) => sum + (r.marks_awarded ?? 0), 0);

      const [{ n }] = await tx
        .select({ n: count() })
        .from(exam_answers)
        .where(
          and(
            eq(exam_answers.attempt_id, attemptId),
            inArray(exam_answers.question_id, textIds),
            isNull(exam_answers.marks_awarded),
          ),
        );
      ungraded = Number(n ?? 0);
    }

    // Only finalize once every text answer is graded; otherwise keep pending.
    if (ungraded === 0) {
      const autoScore = attempt.auto_score ?? 0;
      const score = autoScore + manualScore;
      await tx
        .update(exam_attempts)
        .set({
          manual_score: manualScore,
          score,
          needs_grading: false,
          status: "graded",
          graded_by: graderId,
          graded_at: gradedAt,
        })
        .where(eq(exam_attempts.id, attemptId));

      await awardExamCompletionPunya(
        {
          examId,
          studentId: attempt.student_id,
          attemptId,
          score,
          passMark,
          points: completionPoints,
          awardedBy: graderId,
        },
        tx,
      );

      return {
        finalized: true as const,
        score,
        manualScore,
        ungraded: 0,
      };
    }

    await tx
      .update(exam_attempts)
      .set({
        manual_score: manualScore,
        needs_grading: true,
        status: "submitted",
        graded_by: graderId,
        graded_at: gradedAt,
      })
      .where(eq(exam_attempts.id, attemptId));
    return {
      finalized: false as const,
      manualScore,
      ungraded,
    };
  });

  if (gradeResult.finalized) {
    await auditFromReq(req, {
      action: "grade",
      entityKind: "exam_attempt",
      entityId: attemptId,
      summary: `Finalized exam grading (score ${gradeResult.score}).`,
      metadata: {
        exam_id: examId,
        score: gradeResult.score,
        manual_score: gradeResult.manualScore,
        status: "graded",
      },
    });
    ok(res, { attempt_id: attemptId, score: gradeResult.score, status: "graded" });
    return;
  }

  await auditFromReq(req, {
    action: "grade",
    entityKind: "exam_attempt",
    entityId: attemptId,
    summary: "Partially graded exam attempt (awaiting more grades).",
    metadata: {
      exam_id: examId,
      manual_score: gradeResult.manualScore,
      ungraded: gradeResult.ungraded,
      status: "submitted",
    },
  });

  ok(res, { attempt_id: attemptId, status: "submitted", needs_grading: true });
});

/* POST /v1/exams/:id/attempts/:attemptId/reset — abandon a stuck in_progress attempt */
router.post("/:id/attempts/:attemptId/reset", async (req: Request, res: Response) => {
  if (!canAdministerExams(req.authUser?.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only city admins and above can administer exams.");
    return;
  }
  const cityIds = await cityScopeForUser(req.authUser!);
  const examId = String(req.params.id);
  const attemptId = String(req.params.attemptId);
  const [exam] = await db
    .select({ id: online_exams.id, city_id: online_exams.city_id })
    .from(online_exams)
    .where(eq(online_exams.id, examId))
    .limit(1);
  if (!exam || !cityInScope(cityIds, exam.city_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
    return;
  }

  const [attempt] = await db
    .select({ id: exam_attempts.id, status: exam_attempts.status })
    .from(exam_attempts)
    .where(and(eq(exam_attempts.id, attemptId), eq(exam_attempts.exam_id, examId)))
    .limit(1);
  if (!attempt) {
    fail(res, 404, "ERR_NOT_FOUND", "Attempt not found.");
    return;
  }
  if (attempt.status !== "in_progress") {
    fail(
      res,
      422,
      "ERR_VALIDATION_FAILED",
      "Only in-progress attempts can be reset — this one is already closed.",
    );
    return;
  }

  await db
    .update(exam_attempts)
    .set({ status: "abandoned", updated_at: new Date() })
    .where(eq(exam_attempts.id, attemptId));

  await auditFromReq(req, {
    action: "update",
    entityKind: "exam_attempt",
    entityId: attemptId,
    summary: "Reset (abandoned) an in-progress exam attempt.",
    metadata: { exam_id: examId, status: "abandoned" },
  });

  ok(res, { attempt_id: attemptId, status: "abandoned" });
});

/* ═══════════════════════════ STUDENT — take flow ═══════════════════════════ */

type StudentCtx = { id: string; centre_id: string | null };

/**
 * Resolve which child/self the take-flow acts as (SPEC 6.17 parent / student-view).
 * Reuses ownedStudentsCondition (Q11 active + not soft-deleted; parent_id or user_id).
 * Explicit student_id from body (POST) or query (GET); if omitted and the caller
 * owns exactly one eligible student, default to it — otherwise 422.
 */
async function resolveStudentContext(
  req: Request,
  res: Response,
  studentIdHint?: string | null,
): Promise<StudentCtx | null> {
  const role = req.authUser?.role;
  if (role !== "parent" && role !== "student") {
    fail(res, 403, "ERR_FORBIDDEN", "Parent or student access required.");
    return null;
  }

  const uid = req.authUser!.id;
  const hint = typeof studentIdHint === "string" ? studentIdHint.trim() : "";

  if (hint.length > 0) {
    if (!isUuid(hint)) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "student_id must be a valid UUID.");
      return null;
    }
    // PK + ownership filter — at most one row; ORDER BY keeps selection deterministic.
    const [row] = await db
      .select({ id: students.id, centre_id: students.centre_id })
      .from(students)
      .where(and(eq(students.id, hint), ownedStudentsCondition(uid)))
      .orderBy(asc(students.id))
      .limit(1);
    if (!row) {
      fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
      return null;
    }
    return row;
  }

  const owned = await db
    .select({ id: students.id, centre_id: students.centre_id })
    .from(students)
    .where(ownedStudentsCondition(uid))
    .orderBy(asc(students.full_name), asc(students.id));

  if (owned.length === 0) {
    fail(res, 403, "ERR_FORBIDDEN", "No student profile.");
    return null;
  }
  if (owned.length > 1) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Choose which child is taking this exam.");
    return null;
  }
  return owned[0]!;
}

/** Student-facing question payload — never includes is_correct. */
async function loadStudentExamQuestions(examId: string) {
  const questions = await db
    .select({
      id: exam_questions.id,
      question_en: exam_questions.question_en,
      question_hi: exam_questions.question_hi,
      question_type: exam_questions.question_type,
      marks: exam_questions.marks,
      order_index: exam_questions.order_index,
    })
    .from(exam_questions)
    .where(eq(exam_questions.exam_id, examId))
    .orderBy(asc(exam_questions.order_index), asc(exam_questions.created_at));

  const ids = questions.map((q) => q.id);
  const options = ids.length
    ? await db
        .select({
          id: exam_question_options.id,
          question_id: exam_question_options.question_id,
          option_en: exam_question_options.option_en,
          option_hi: exam_question_options.option_hi,
          order_index: exam_question_options.order_index,
        })
        .from(exam_question_options)
        .where(inArray(exam_question_options.question_id, ids))
        .orderBy(asc(exam_question_options.order_index), asc(exam_question_options.created_at))
    : [];

  return questions.map((q) => ({
    id: q.id,
    question_en: q.question_en,
    question_hi: q.question_hi,
    question_type: q.question_type,
    marks: q.marks,
    options: options
      .filter((o) => o.question_id === q.id)
      .map((o) => ({ id: o.id, option_en: o.option_en, option_hi: o.option_hi })),
  }));
}

/* GET /v1/exams/available — exams in the student's city, live or upcoming */
router.get("/available", async (req: Request, res: Response) => {
  const hint = typeof req.query.student_id === "string" ? req.query.student_id : undefined;
  const student = await resolveStudentContext(req, res, hint);
  if (!student) return;
  const cityId = await cityForStudent(student.centre_id);
  if (!cityId) {
    ok(res, { items: [] }, { count: 0 });
    return;
  }

  const now = new Date();
  const rows = await db
    .select({
      id: online_exams.id,
      title_en: online_exams.title_en,
      title_hi: online_exams.title_hi,
      window_start: online_exams.window_start,
      window_end: online_exams.window_end,
      total_marks: online_exams.total_marks,
      pass_mark: online_exams.pass_mark,
      max_attempts: online_exams.max_attempts,
      exam_otp: online_exams.exam_otp,
      exam_otp_hash: online_exams.exam_otp_hash,
    })
    .from(online_exams)
    .where(and(eq(online_exams.city_id, cityId), sql`${online_exams.window_end} >= ${now}`))
    .orderBy(asc(online_exams.window_start));

  const counts = await db
    .select({
      exam_id: exam_attempts.exam_id,
      n: sql<number>`count(*)::int`,
    })
    .from(exam_attempts)
    .where(
      and(
        eq(exam_attempts.student_id, student.id),
        // Abandoned attempts free a slot — do not count them toward max_attempts.
        ne(exam_attempts.status, "abandoned"),
      ),
    )
    .groupBy(exam_attempts.exam_id);
  const countByExam = new Map(counts.map((c) => [c.exam_id, c.n]));

  // Latest in_progress attempt per exam (resume after app kill — H3).
  const openRows = await db
    .select({
      exam_id: exam_attempts.exam_id,
      id: exam_attempts.id,
      started_at: exam_attempts.started_at,
    })
    .from(exam_attempts)
    .where(
      and(eq(exam_attempts.student_id, student.id), eq(exam_attempts.status, "in_progress")),
    )
    .orderBy(asc(exam_attempts.started_at));
  const openByExam = new Map<string, string>();
  for (const row of openRows) {
    // Ascending start — last write wins so the newest open attempt is resumed.
    openByExam.set(row.exam_id, row.id);
  }

  const items = rows.map((r) => ({
    id: r.id,
    title_en: r.title_en,
    title_hi: r.title_hi,
    window_start: r.window_start.toISOString(),
    window_end: r.window_end.toISOString(),
    total_marks: r.total_marks,
    pass_mark: r.pass_mark,
    max_attempts: r.max_attempts,
    requires_otp: !!(r.exam_otp_hash || r.exam_otp),
    already_attempted_count: countByExam.get(r.id) ?? 0,
    open_attempt_id: openByExam.get(r.id) ?? null,
  }));
  ok(res, { items }, { count: items.length });
});

const startSchema = z.object({
  otp: z.string().max(40).optional(),
  student_id: z.string().uuid().optional(),
});

/* POST /v1/exams/:id/start — open an attempt, return questions without answers */
router.post("/:id/start", async (req: Request, res: Response) => {
  let body: z.infer<typeof startSchema>;
  try {
    body = startSchema.parse(req.body ?? {});
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid start payload.");
    return;
  }

  const student = await resolveStudentContext(req, res, body.student_id);
  if (!student) return;

  const uid = req.authUser!.id;
  const examId = String(req.params.id);
  // Per (user, student): keying on the parent alone meant a family of four
  // shared ten starts an hour — the same squeeze already fixed for the OTP
  // limiter below and for niyam submission.
  if (await rateLimit(`exam:start:user:${uid}:${student.id}`, 10, 3600)) {
    fail(res, 429, "ERR_RATE_LIMITED", "Too many exam starts for this student — try again later.");
    return;
  }

  const [exam] = await db
    .select()
    .from(online_exams)
    .where(eq(online_exams.id, examId))
    .limit(1);
  if (!exam) {
    fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
    return;
  }

  const cityId = await cityForStudent(student.centre_id);
  if (!cityId || cityId !== exam.city_id) {
    fail(res, 403, "ERR_FORBIDDEN", "This exam is not available for you.");
    return;
  }

  const now = new Date();
  if (now < exam.window_start || now > exam.window_end) {
    fail(res, 422, "ERR_WINDOW_CLOSED", "The exam window is not open.");
    return;
  }

  const requiresOtp = !!(exam.exam_otp_hash || exam.exam_otp);
  let otpVerifiedAt: Date | null = null;
  if (requiresOtp) {
    const submitted = body.otp ?? "";
    let okCode = false;
    if (exam.exam_otp_hash) {
      okCode = await verifyOtpCode(exam.exam_otp_hash, submitted);
    } else if (exam.exam_otp) {
      // Legacy plaintext — one-release bridge while exam_otp_hash is NULL.
      okCode = timingSafeEqualString(submitted, exam.exam_otp);
    }
    if (!okCode) {
      // Count only failed OTP checks; key per (caller, student) so siblings
      // sitting the same exam do not share one budget (N4).
      if (
        await rateLimit(
          `exam:start:exam:${examId}:user:${uid}:${student.id}`,
          5,
          900,
        )
      ) {
        fail(res, 429, "ERR_RATE_LIMITED", "Too many requests. Please try again later.");
        return;
      }
      fail(res, 401, "ERR_OTP_INVALID", "Invalid exam access code.");
      return;
    }
    otpVerifiedAt = now;
  }

  // Atomically count existing attempts and insert the new one so two parallel
  // starts cannot both pass the cap check (count-then-insert TOCTOU). Under
  // READ COMMITTED a plain count+insert is racy, so serialize per (exam,student)
  // with a transaction-scoped advisory lock.
  const startResult = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${examId}:${student.id}`}, 0))`);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(exam_attempts)
      .where(
        and(
          eq(exam_attempts.exam_id, examId),
          eq(exam_attempts.student_id, student.id),
          // Abandoned does not consume a max_attempts slot (admin reset / cron).
          ne(exam_attempts.status, "abandoned"),
        ),
      );
    if ((n ?? 0) >= exam.max_attempts) {
      return { capped: true as const };
    }
    const [created] = await tx
      .insert(exam_attempts)
      .values({
        exam_id: examId,
        student_id: student.id,
        started_at: now,
        status: "in_progress",
        needs_grading: false,
        otp_verified_at: otpVerifiedAt,
      })
      .returning({ id: exam_attempts.id });
    return { capped: false as const, attempt: created };
  });
  if (startResult.capped) {
    fail(res, 409, "ERR_MAX_ATTEMPTS", "You have used all your attempts.");
    return;
  }
  const attempt = startResult.attempt;

  const out = await loadStudentExamQuestions(examId);
  ok(res, { attempt_id: attempt.id, questions: out });
});

const answerSaveSchema = z.object({
  student_id: z.string().uuid().optional(),
  selected_option_ids: z.array(z.string().uuid()).max(50).optional(),
  text_answer: z.string().max(10000).optional(),
});

/**
 * GET /v1/exams/attempts/:attemptId — resume an in_progress attempt (H3).
 * Returns questions (no is_correct) + saved answers (no marks_awarded).
 */
router.get("/attempts/:attemptId", async (req: Request, res: Response) => {
  const hint = typeof req.query.student_id === "string" ? req.query.student_id : undefined;
  const student = await resolveStudentContext(req, res, hint);
  if (!student) return;

  const attemptId = String(req.params.attemptId);
  if (!isUuid(attemptId)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid attempt id.");
    return;
  }

  const [attempt] = await db
    .select({
      id: exam_attempts.id,
      exam_id: exam_attempts.exam_id,
      student_id: exam_attempts.student_id,
      status: exam_attempts.status,
    })
    .from(exam_attempts)
    .where(eq(exam_attempts.id, attemptId))
    .limit(1);
  if (!attempt || attempt.student_id !== student.id) {
    fail(res, 404, "ERR_NOT_FOUND", "Attempt not found.");
    return;
  }
  if (attempt.status !== "in_progress") {
    fail(res, 409, "ERR_ALREADY_SUBMITTED", "This attempt was already submitted.");
    return;
  }

  const [exam] = await db
    .select({
      id: online_exams.id,
      title_en: online_exams.title_en,
      title_hi: online_exams.title_hi,
      window_end: online_exams.window_end,
      total_marks: online_exams.total_marks,
    })
    .from(online_exams)
    .where(eq(online_exams.id, attempt.exam_id))
    .limit(1);
  if (!exam) {
    fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
    return;
  }

  const questions = await loadStudentExamQuestions(exam.id);
  const savedRows = await db
    .select({
      question_id: exam_answers.question_id,
      selected_option_ids: exam_answers.selected_option_ids,
      text_answer: exam_answers.text_answer,
    })
    .from(exam_answers)
    .where(eq(exam_answers.attempt_id, attemptId));

  ok(res, {
    attempt_id: attempt.id,
    exam_id: exam.id,
    title_en: exam.title_en,
    title_hi: exam.title_hi,
    window_end: exam.window_end.toISOString(),
    total_marks: exam.total_marks,
    questions,
    // Correctness / marks stay null until submit — never leak here.
    answers: savedRows.map((r) => ({
      question_id: r.question_id,
      selected_option_ids: r.selected_option_ids ?? [],
      text_answer: r.text_answer,
    })),
  });
});

/**
 * PUT /v1/exams/attempts/:attemptId/answers/:questionId — incremental save
 * (SPEC §6.17 answer). Upserts answer payload only; never grades. Idempotent
 * on UNIQUE (attempt_id, question_id).
 */
router.put(
  "/attempts/:attemptId/answers/:questionId",
  async (req: Request, res: Response) => {
    let body: z.infer<typeof answerSaveSchema>;
    try {
      body = answerSaveSchema.parse(req.body ?? {});
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid answer payload.");
      return;
    }
    const student = await resolveStudentContext(req, res, body.student_id);
    if (!student) return;

    const attemptId = String(req.params.attemptId);
    const questionId = String(req.params.questionId);
    if (!isUuid(attemptId) || !isUuid(questionId)) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid attempt or question id.");
      return;
    }

    const [attempt] = await db
      .select({
        id: exam_attempts.id,
        exam_id: exam_attempts.exam_id,
        student_id: exam_attempts.student_id,
        status: exam_attempts.status,
      })
      .from(exam_attempts)
      .where(eq(exam_attempts.id, attemptId))
      .limit(1);
    if (!attempt || attempt.student_id !== student.id) {
      fail(res, 404, "ERR_NOT_FOUND", "Attempt not found.");
      return;
    }
    if (attempt.status !== "in_progress") {
      fail(res, 409, "ERR_ALREADY_SUBMITTED", "This attempt was already submitted.");
      return;
    }

    const [parentExam] = await db
      .select({ window_end: online_exams.window_end })
      .from(online_exams)
      .where(eq(online_exams.id, attempt.exam_id))
      .limit(1);
    if (!parentExam) {
      fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
      return;
    }
    if (Date.now() > parentExam.window_end.getTime()) {
      fail(
        res,
        422,
        "ERR_WINDOW_CLOSED",
        "The exam window has closed — answers can no longer be saved.",
      );
      return;
    }

    const [question] = await db
      .select({ id: exam_questions.id, exam_id: exam_questions.exam_id })
      .from(exam_questions)
      .where(eq(exam_questions.id, questionId))
      .limit(1);
    if (!question || question.exam_id !== attempt.exam_id) {
      fail(res, 404, "ERR_NOT_FOUND", "Question not found on this exam.");
      return;
    }

    const selected = body.selected_option_ids ?? [];
    if (selected.length > 0) {
      const check = await assertOptionsBelongToQuestions([
        { question_id: questionId, selected_option_ids: selected },
      ]);
      if (!check.ok) {
        fail(
          res,
          422,
          "ERR_VALIDATION_FAILED",
          "One or more selected options do not belong to this question.",
        );
        return;
      }
    }

    const textAnswer = body.text_answer ?? null;

    // Store answer only — grading columns stay NULL until submit so a partial
    // save can never leak correctness to a later read of exam_answers.
    await db
      .insert(exam_answers)
      .values({
        attempt_id: attemptId,
        question_id: questionId,
        selected_option_ids: selected,
        text_answer: textAnswer,
        is_correct: null,
        marks_awarded: null,
      })
      .onConflictDoUpdate({
        target: [exam_answers.attempt_id, exam_answers.question_id],
        set: {
          selected_option_ids: selected,
          text_answer: textAnswer,
          is_correct: null,
          marks_awarded: null,
        },
      });

    ok(res, {
      attempt_id: attemptId,
      question_id: questionId,
      selected_option_ids: selected,
      text_answer: textAnswer,
    });
  },
);

const submitSchema = z.object({
  student_id: z.string().uuid().optional(),
  answers: z
    .array(
      z.object({
        question_id: z.string().uuid(),
        selected_option_ids: z.array(z.string().uuid()).max(50).optional(),
        text_answer: z.string().max(10000).optional(),
      }),
    )
    .max(200)
    .default([]),
});

/* POST /v1/exams/attempts/:attemptId/submit — submit answers, auto-grade */
router.post("/attempts/:attemptId/submit", async (req: Request, res: Response) => {
  let body: z.infer<typeof submitSchema>;
  try {
    body = submitSchema.parse(req.body ?? {});
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid submit payload.");
    return;
  }
  const student = await resolveStudentContext(req, res, body.student_id);
  if (!student) return;

  const attemptId = String(req.params.attemptId);
  const [attempt] = await db
    .select({
      id: exam_attempts.id,
      exam_id: exam_attempts.exam_id,
      student_id: exam_attempts.student_id,
      status: exam_attempts.status,
    })
    .from(exam_attempts)
    .where(eq(exam_attempts.id, attemptId))
    .limit(1);
  if (!attempt || attempt.student_id !== student.id) {
    fail(res, 404, "ERR_NOT_FOUND", "Attempt not found.");
    return;
  }
  if (attempt.status !== "in_progress") {
    fail(res, 409, "ERR_ALREADY_SUBMITTED", "This attempt was already submitted.");
    return;
  }

  // Enforce the exam window at submit too — start already checked it, but a
  // student who stays open past window_end must not still grade and persist.
  const [parentExam] = await db
    .select({
      window_end: online_exams.window_end,
      city_id: online_exams.city_id,
      pass_mark: online_exams.pass_mark,
      completion_points: online_exams.completion_points,
    })
    .from(online_exams)
    .where(eq(online_exams.id, attempt.exam_id))
    .limit(1);
  if (!parentExam) {
    fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
    return;
  }
  if (Date.now() > parentExam.window_end.getTime()) {
    fail(
      res,
      422,
      "ERR_WINDOW_CLOSED",
      "The exam window has closed — this attempt can no longer be submitted. Ask an admin to reset it if you need another attempt.",
    );
    return;
  }

  // Reject foreign option ids before any grading / writes (same rule as autosave).
  const optionCheck = await assertOptionsBelongToQuestions(
    body.answers.map((a) => ({
      question_id: a.question_id,
      selected_option_ids: a.selected_option_ids ?? [],
    })),
  );
  if (!optionCheck.ok) {
    fail(
      res,
      422,
      "ERR_VALIDATION_FAILED",
      "One or more selected options do not belong to this question.",
    );
    return;
  }

  // Load this exam's questions + correct-option sets for objective grading.
  const questions = await db
    .select({
      id: exam_questions.id,
      question_type: exam_questions.question_type,
      marks: exam_questions.marks,
    })
    .from(exam_questions)
    .where(eq(exam_questions.exam_id, attempt.exam_id));

  const qIds = questions.map((q) => q.id);
  const correctRows = qIds.length
    ? await db
        .select({ question_id: exam_question_options.question_id, id: exam_question_options.id })
        .from(exam_question_options)
        .where(
          and(
            inArray(exam_question_options.question_id, qIds),
            eq(exam_question_options.is_correct, true),
          ),
        )
    : [];
  const correctByQuestion = new Map<string, string[]>();
  for (const r of correctRows) {
    const arr = correctByQuestion.get(r.question_id) ?? [];
    arr.push(r.id);
    correctByQuestion.set(r.question_id, arr);
  }

  // Body entries win; questions absent from the body keep any autosaved row
  // (otherwise we would wipe incremental saves with empty defaults).
  const answerByQuestion = new Map(body.answers.map((a) => [a.question_id, a]));
  const savedRows = await db
    .select({
      question_id: exam_answers.question_id,
      selected_option_ids: exam_answers.selected_option_ids,
      text_answer: exam_answers.text_answer,
    })
    .from(exam_answers)
    .where(eq(exam_answers.attempt_id, attemptId));
  const savedByQuestion = new Map(savedRows.map((r) => [r.question_id, r]));

  // Grade in memory BEFORE the transaction. Mutating autoScore inside the
  // callback would double-count if the driver ever retried the transaction.
  const gradedRows: Array<{
    question_id: string;
    selected_option_ids: string[];
    text_answer: string | null;
    is_correct: boolean | null;
    marks_awarded: number | null;
  }> = [];
  let autoScore = 0;
  let hasText = false;
  for (const q of questions) {
    if (q.question_type === "text") hasText = true;

    const ans = answerByQuestion.get(q.id);
    const saved = savedByQuestion.get(q.id);
    const selected = ans
      ? (ans.selected_option_ids ?? [])
      : (saved?.selected_option_ids ?? []);
    const textAnswer = ans ? (ans.text_answer ?? null) : (saved?.text_answer ?? null);

    let isCorrect: boolean | null = null;
    let marksAwarded: number | null = null;

    if (q.question_type === "text") {
      // Subjective: leave is_correct + marks_awarded NULL so the grade route
      // counts this as awaiting a grade — even if the student skipped it.
      isCorrect = null;
      marksAwarded = null;
    } else {
      const correct = correctByQuestion.get(q.id) ?? [];
      const ok2 = sameIdSet(selected, correct);
      isCorrect = ok2;
      marksAwarded = ok2 ? q.marks : 0;
      autoScore += marksAwarded;
    }

    gradedRows.push({
      question_id: q.id,
      selected_option_ids: selected,
      text_answer: textAnswer,
      is_correct: isCorrect,
      marks_awarded: marksAwarded,
    });
  }

  const needsGrading = hasText;
  const finalScore = needsGrading ? null : autoScore;
  const finalStatus = needsGrading ? "submitted" : "graded";
  const now = new Date();

  // Resolve Punya before the write transaction (avoid a second pool connection
  // while the TX holds rows — same pattern as the manual grade finalize path).
  const completionPoints =
    finalStatus === "graded"
      ? await resolveExamCompletionPoints(parentExam.city_id, parentExam.completion_points)
      : 0;

  // Pure writes — one exam_answers row per question (answered or skipped).
  await db.transaction(async (tx) => {
    for (const row of gradedRows) {
      await tx
        .insert(exam_answers)
        .values({
          attempt_id: attemptId,
          question_id: row.question_id,
          selected_option_ids: row.selected_option_ids,
          text_answer: row.text_answer,
          is_correct: row.is_correct,
          marks_awarded: row.marks_awarded,
        })
        .onConflictDoUpdate({
          target: [exam_answers.attempt_id, exam_answers.question_id],
          set: {
            selected_option_ids: row.selected_option_ids,
            text_answer: row.text_answer,
            is_correct: row.is_correct,
            marks_awarded: row.marks_awarded,
          },
        });
    }

    await tx
      .update(exam_attempts)
      .set({
        submitted_at: now,
        auto_score: autoScore,
        score: finalScore,
        needs_grading: needsGrading,
        status: finalStatus,
      })
      .where(eq(exam_attempts.id, attemptId));

    if (finalStatus === "graded") {
      await awardExamCompletionPunya(
        {
          examId: attempt.exam_id,
          studentId: attempt.student_id,
          attemptId,
          score: autoScore,
          passMark: parentExam.pass_mark,
          points: completionPoints,
          awardedBy: null,
        },
        tx,
      );
    }
  });

  await auditFromReq(req, {
    action: "create",
    entityKind: "exam_attempt",
    entityId: attemptId,
    summary: needsGrading
      ? "Submitted exam attempt (awaiting manual grading)."
      : `Submitted exam attempt (auto-graded ${autoScore}).`,
    metadata: {
      exam_id: attempt.exam_id,
      auto_score: autoScore,
      needs_grading: needsGrading,
      status: finalStatus,
    },
  });

  ok(res, {
    attempt_id: attemptId,
    status: finalStatus,
    auto_score: autoScore,
    needs_grading: needsGrading,
    score: finalScore,
  });
});

/* GET /v1/exams/attempts/:attemptId/result — student result */
router.get("/attempts/:attemptId/result", async (req: Request, res: Response) => {
  const hint = typeof req.query.student_id === "string" ? req.query.student_id : undefined;
  const student = await resolveStudentContext(req, res, hint);
  if (!student) return;
  const attemptId = String(req.params.attemptId);
  const [attempt] = await db
    .select({
      id: exam_attempts.id,
      exam_id: exam_attempts.exam_id,
      student_id: exam_attempts.student_id,
      status: exam_attempts.status,
      score: exam_attempts.score,
      needs_grading: exam_attempts.needs_grading,
    })
    .from(exam_attempts)
    .where(eq(exam_attempts.id, attemptId))
    .limit(1);
  if (!attempt || attempt.student_id !== student.id) {
    fail(res, 404, "ERR_NOT_FOUND", "Attempt not found.");
    return;
  }

  // Never disclose scores for attempts still open or abandoned — do this before
  // the results_released gate so in_progress never leaks score/per_question.
  if (attempt.status === "in_progress") {
    ok(res, { status: "in_progress" });
    return;
  }
  if (attempt.status === "abandoned") {
    ok(res, { status: "abandoned" });
    return;
  }

  const [exam] = await db
    .select({
      total_marks: online_exams.total_marks,
      pass_mark: online_exams.pass_mark,
      results_released: online_exams.results_released,
    })
    .from(online_exams)
    .where(eq(online_exams.id, attempt.exam_id))
    .limit(1);

  // Gate ALL disclosure on results_released — even objective-only exams that
  // auto-grade instantly must withhold score + per-question until released.
  if (!(exam && exam.results_released)) {
    ok(res, { status: attempt.status, needs_grading: attempt.needs_grading });
    return;
  }

  const perQuestion = await db
    .select({
      question_id: exam_answers.question_id,
      question_en: exam_questions.question_en,
      question_hi: exam_questions.question_hi,
      marks: exam_questions.marks,
      marks_awarded: exam_answers.marks_awarded,
      is_correct: exam_answers.is_correct,
      order_index: exam_questions.order_index,
    })
    .from(exam_answers)
    .innerJoin(exam_questions, eq(exam_questions.id, exam_answers.question_id))
    .where(eq(exam_answers.attempt_id, attemptId))
    .orderBy(asc(exam_questions.order_index), asc(exam_questions.id));

  const score = attempt.score ?? 0;
  const passMark = exam?.pass_mark ?? 0;
  ok(res, {
    status: attempt.status,
    score,
    total_marks: exam?.total_marks ?? 0,
    pass_mark: passMark,
    passed: score >= passMark,
    per_question: perQuestion.map((p) => ({
      question_id: p.question_id,
      question_en: p.question_en,
      question_hi: p.question_hi,
      marks: p.marks,
      marks_awarded: p.marks_awarded,
      is_correct: p.is_correct,
    })),
  });
});

export default router;
