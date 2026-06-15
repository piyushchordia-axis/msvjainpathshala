/**
 * /v1/exams — full online exams: question/option authoring (admin), the student
 * take flow (available → start → submit → result), and auto + manual grading.
 *
 * Exams are CITY-scoped. Admin authoring/grading routes require the admin panel
 * and verify the exam's city is in the caller's city scope (404 out of scope).
 * Student routes require role 'student', resolve the caller's single student
 * profile, and confirm the exam's city matches the student's centre city.
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
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { canAccessAdminPanel } from "@workspace/api-zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope } from "../../lib/scope";

const router: IRouter = Router();
router.use(requireAuth);

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

/** The single student row owned by this user, or null. */
async function studentForUser(uid: string) {
  const [row] = await db
    .select({ id: students.id, centre_id: students.centre_id })
    .from(students)
    .where(eq(students.user_id, uid))
    .limit(1);
  return row ?? null;
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

/* ═══════════════════════════ ADMIN — authoring ═══════════════════════════ */

/* GET /v1/exams/:id/questions — admin view (includes is_correct) */
router.get("/:id/questions", async (req: Request, res: Response) => {
  if (!canAccessAdminPanel(req.authUser?.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Admin panel access required.");
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
  if (!canAccessAdminPanel(req.authUser?.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Admin panel access required.");
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

  ok(res, { id: question.id });
});

/* DELETE /v1/exams/:id/questions/:qid — remove a question (options cascade) */
router.delete("/:id/questions/:qid", async (req: Request, res: Response) => {
  if (!canAccessAdminPanel(req.authUser?.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Admin panel access required.");
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
  ok(res, { id: qid, deleted: true });
});

/* ═══════════════════════════ ADMIN — grading ═══════════════════════════ */

/* GET /v1/exams/:id/attempts/:attemptId — attempt detail with answers joined */
router.get("/:id/attempts/:attemptId", async (req: Request, res: Response) => {
  if (!canAccessAdminPanel(req.authUser?.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Admin panel access required.");
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
    })),
  });
});

const gradeSchema = z.object({
  grades: z
    .array(
      z.object({
        question_id: z.string().uuid(),
        marks_awarded: z.coerce.number().int().min(0),
      }),
    )
    .min(1),
});

/* POST /v1/exams/:id/attempts/:attemptId/grade — manual grade text answers */
router.post("/:id/attempts/:attemptId/grade", async (req: Request, res: Response) => {
  if (!canAccessAdminPanel(req.authUser?.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Admin panel access required.");
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
      auto_score: exam_attempts.auto_score,
      status: exam_attempts.status,
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

  // Text questions for this exam, with their max marks.
  const textQuestions = await db
    .select({ id: exam_questions.id, marks: exam_questions.marks })
    .from(exam_questions)
    .where(and(eq(exam_questions.exam_id, examId), eq(exam_questions.question_type, "text")));
  const textMax = new Map(textQuestions.map((q) => [q.id, q.marks]));

  for (const g of body.grades) {
    const max = textMax.get(g.question_id);
    if (max === undefined) continue; // only text questions are gradable
    const awarded = Math.max(0, Math.min(g.marks_awarded, max));
    await db
      .update(exam_answers)
      .set({ marks_awarded: awarded, is_correct: awarded > 0 })
      .where(and(eq(exam_answers.attempt_id, attemptId), eq(exam_answers.question_id, g.question_id)));
  }

  // Recompute manual_score = sum of all graded text answers for this attempt.
  const textIds = textQuestions.map((q) => q.id);
  let manualScore = 0;
  let ungraded = 0;
  if (textIds.length > 0) {
    const graded = await db
      .select({ marks_awarded: exam_answers.marks_awarded })
      .from(exam_answers)
      .where(
        and(
          eq(exam_answers.attempt_id, attemptId),
          inArray(exam_answers.question_id, textIds),
        ),
      );
    manualScore = graded.reduce((sum, r) => sum + (r.marks_awarded ?? 0), 0);

    // Count this attempt's text answers still awaiting a grade (NULL marks).
    const [{ n }] = await db
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

  // Only finalize (status=graded, needs_grading=false, recompute score) once
  // every text answer is graded; otherwise keep it pending with partial marks.
  if (ungraded === 0) {
    const autoScore = attempt.auto_score ?? 0;
    const score = autoScore + manualScore;
    await db
      .update(exam_attempts)
      .set({
        manual_score: manualScore,
        score,
        needs_grading: false,
        status: "graded",
        graded_by: req.authUser!.id,
        graded_at: new Date(),
      })
      .where(eq(exam_attempts.id, attemptId));

    ok(res, { attempt_id: attemptId, score, status: "graded" });
    return;
  }

  // Partial grading: persist the marks awarded so far but stay submitted.
  await db
    .update(exam_attempts)
    .set({
      manual_score: manualScore,
      needs_grading: true,
      status: "submitted",
      graded_by: req.authUser!.id,
      graded_at: new Date(),
    })
    .where(eq(exam_attempts.id, attemptId));

  ok(res, { attempt_id: attemptId, status: "submitted", needs_grading: true });
});

/* ═══════════════════════════ STUDENT — take flow ═══════════════════════════ */

/** Resolve student or fail 403; returns null after responding when no profile. */
async function requireStudent(req: Request, res: Response) {
  if (req.authUser?.role !== "student") {
    fail(res, 403, "ERR_FORBIDDEN", "Student access required.");
    return null;
  }
  const student = await studentForUser(req.authUser.id);
  if (!student) {
    fail(res, 403, "ERR_FORBIDDEN", "No student profile.");
    return null;
  }
  return student;
}

/* GET /v1/exams/available — exams in the student's city, live or upcoming */
router.get("/available", async (req: Request, res: Response) => {
  const student = await requireStudent(req, res);
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
    .where(eq(exam_attempts.student_id, student.id))
    .groupBy(exam_attempts.exam_id);
  const countByExam = new Map(counts.map((c) => [c.exam_id, c.n]));

  const items = rows.map((r) => ({
    id: r.id,
    title_en: r.title_en,
    title_hi: r.title_hi,
    window_start: r.window_start.toISOString(),
    window_end: r.window_end.toISOString(),
    total_marks: r.total_marks,
    pass_mark: r.pass_mark,
    max_attempts: r.max_attempts,
    requires_otp: !!r.exam_otp,
    already_attempted_count: countByExam.get(r.id) ?? 0,
  }));
  ok(res, { items }, { count: items.length });
});

const startSchema = z.object({
  otp: z.string().max(40).optional(),
});

/* POST /v1/exams/:id/start — open an attempt, return questions without answers */
router.post("/:id/start", async (req: Request, res: Response) => {
  const student = await requireStudent(req, res);
  if (!student) return;
  let body: z.infer<typeof startSchema>;
  try {
    body = startSchema.parse(req.body ?? {});
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid start payload.");
    return;
  }

  const examId = String(req.params.id);
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

  if (exam.exam_otp) {
    if (!body.otp || body.otp !== exam.exam_otp) {
      fail(res, 401, "ERR_OTP_INVALID", "Invalid exam access code.");
      return;
    }
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
      .where(and(eq(exam_attempts.exam_id, examId), eq(exam_attempts.student_id, student.id)));
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
      })
      .returning({ id: exam_attempts.id });
    return { capped: false as const, attempt: created };
  });
  if (startResult.capped) {
    fail(res, 409, "ERR_MAX_ATTEMPTS", "You have used all your attempts.");
    return;
  }
  const attempt = startResult.attempt;

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

  const out = questions.map((q) => ({
    id: q.id,
    question_en: q.question_en,
    question_hi: q.question_hi,
    question_type: q.question_type,
    marks: q.marks,
    // is_correct is deliberately stripped from the student payload.
    options: options
      .filter((o) => o.question_id === q.id)
      .map((o) => ({ id: o.id, option_en: o.option_en, option_hi: o.option_hi })),
  }));

  ok(res, { attempt_id: attempt.id, questions: out });
});

const submitSchema = z.object({
  answers: z
    .array(
      z.object({
        question_id: z.string().uuid(),
        selected_option_ids: z.array(z.string().uuid()).optional(),
        text_answer: z.string().max(10000).optional(),
      }),
    )
    .default([]),
});

/* POST /v1/exams/attempts/:attemptId/submit — submit answers, auto-grade */
router.post("/attempts/:attemptId/submit", async (req: Request, res: Response) => {
  const student = await requireStudent(req, res);
  if (!student) return;
  let body: z.infer<typeof submitSchema>;
  try {
    body = submitSchema.parse(req.body ?? {});
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid submit payload.");
    return;
  }

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

  // Load this exam's questions + correct-option sets for objective grading.
  const questions = await db
    .select({
      id: exam_questions.id,
      question_type: exam_questions.question_type,
      marks: exam_questions.marks,
    })
    .from(exam_questions)
    .where(eq(exam_questions.exam_id, attempt.exam_id));
  const qById = new Map(questions.map((q) => [q.id, q]));

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

  let autoScore = 0;
  let hasText = false;
  for (const q of questions) if (q.question_type === "text") hasText = true;

  for (const ans of body.answers) {
    const q = qById.get(ans.question_id);
    if (!q) continue; // ignore answers for unrelated questions

    let isCorrect: boolean | null = null;
    let marksAwarded: number | null = null;
    const selected = ans.selected_option_ids ?? [];

    if (q.question_type === "text") {
      isCorrect = null;
      marksAwarded = null;
    } else {
      const correct = correctByQuestion.get(q.id) ?? [];
      const ok2 = sameIdSet(selected, correct);
      isCorrect = ok2;
      marksAwarded = ok2 ? q.marks : 0;
      autoScore += marksAwarded;
    }

    // Upsert by (attempt_id, question_id) unique index.
    await db
      .insert(exam_answers)
      .values({
        attempt_id: attemptId,
        question_id: q.id,
        selected_option_ids: selected,
        text_answer: ans.text_answer ?? null,
        is_correct: isCorrect,
        marks_awarded: marksAwarded,
      })
      .onConflictDoUpdate({
        target: [exam_answers.attempt_id, exam_answers.question_id],
        set: {
          selected_option_ids: selected,
          text_answer: ans.text_answer ?? null,
          is_correct: isCorrect,
          marks_awarded: marksAwarded,
        },
      });
  }

  const now = new Date();
  const needsGrading = hasText;
  const finalScore = needsGrading ? null : autoScore;
  const finalStatus = needsGrading ? "submitted" : "graded";

  await db
    .update(exam_attempts)
    .set({
      submitted_at: now,
      auto_score: autoScore,
      score: finalScore,
      needs_grading: needsGrading,
      status: finalStatus,
    })
    .where(eq(exam_attempts.id, attemptId));

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
  const student = await requireStudent(req, res);
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
      marks_awarded: exam_answers.marks_awarded,
      is_correct: exam_answers.is_correct,
    })
    .from(exam_answers)
    .where(eq(exam_answers.attempt_id, attemptId));

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
      marks_awarded: p.marks_awarded,
      is_correct: p.is_correct,
    })),
  });
});

export default router;
