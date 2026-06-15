/**
 * /v1/quizzes — quiz system: a shared question bank, scheduled quiz events, and
 * shikshak-initiated live "push" quizzes. Polling-based (no websockets).
 *
 * router.use(requireAuth): every route needs a logged-in user. Admin-panel
 * authoring/listing routes additionally gate with requireAdminPanel; the
 * student take-flow routes resolve + verify ownership of the student id passed.
 *
 * Question bank + scheduled events are CITY-scoped. Push quizzes are batch-scoped
 * (a shikshak who teaches that batch, or an admin whose scope covers its centre).
 *
 * Grading: an answer for a question is correct iff the SET of selected indices
 * equals the SET of that question's correct_indices (order-independent).
 * score = correct_count. Point awards are idempotent — guarded on submitted_at so
 * re-calling submit never double-awards.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  questions,
  quiz_events,
  quiz_event_questions,
  quiz_attempts,
  push_quizzes,
  push_quiz_questions,
  push_quiz_attempts,
  students,
  centres,
  batches,
  cities,
  type User,
} from "@workspace/db";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { canAccessAdminPanel } from "@workspace/api-zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth } from "../../middlewares/auth";
import { resolveAdminScope } from "../../lib/scope";
import { awardPunya } from "../../lib/punya";
import { auditFromReq } from "../../lib/audit";

const router: IRouter = Router();
router.use(requireAuth);

const QUIZ_SCOPES = ["national", "state", "city", "centre", "batch"] as const;

/* ---- city scope: null = all (super_admin); [] = nothing; else city ids ---- */
async function cityScopeForUser(user: User): Promise<string[] | null> {
  if (user.role === "super_admin") return null;
  if (user.role === "city_admin") return user.city_id ? [user.city_id] : [];
  if (user.role === "state_admin") {
    if (!user.state_id) return [];
    const rows = await db.select({ id: cities.id }).from(cities).where(eq(cities.state_id, user.state_id));
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

/** The single student row owned by this user (parent of, or is), or null. */
async function ownedStudent(req: Request, studentId: string) {
  const uid = req.authUser!.id;
  const [row] = await db
    .select({
      id: students.id,
      centre_id: students.centre_id,
      batch_id: students.batch_id,
      age_group: students.age_group,
    })
    .from(students)
    .where(
      and(
        eq(students.id, studentId),
        or(eq(students.parent_id, uid), eq(students.user_id, uid)),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The city of a student via their centre, or null. */
async function cityForCentre(centreId: string | null): Promise<string | null> {
  if (!centreId) return null;
  const [row] = await db
    .select({ city_id: centres.city_id })
    .from(centres)
    .where(eq(centres.id, centreId))
    .limit(1);
  return row?.city_id ?? null;
}

/** Compare two number sets for equality, order-independent. */
function sameIndexSet(a: number[], b: number[]): boolean {
  const sa = Array.from(new Set(a));
  const sb = Array.from(new Set(b));
  if (sa.length !== sb.length) return false;
  const set = new Set(sa);
  for (const x of sb) if (!set.has(x)) return false;
  return true;
}

/**
 * Does this scheduled event apply to the given student? city / centre / batch
 * narrow successively; national/state events apply by the student's city being
 * present (state events still resolve to a concrete city on the event row).
 *
 * age_groups targeting: when the event lists one or more age groups, the student
 * must fall into one of them; an empty list targets all age groups. This gate is
 * applied on top of the geographic narrowing below.
 */
function eventMatchesStudent(
  ev: {
    scope: string;
    city_id: string | null;
    centre_id: string | null;
    batch_id: string | null;
    age_groups: string[];
  },
  student: { centre_id: string | null; batch_id: string | null; age_group: string | null },
  studentCityId: string | null,
): boolean {
  // Age-group targeting: a non-empty list must include the student's age group.
  if (ev.age_groups.length > 0 && !(student.age_group && ev.age_groups.includes(student.age_group))) {
    return false;
  }
  if (ev.batch_id) return ev.batch_id === student.batch_id;
  if (ev.centre_id) return ev.centre_id === student.centre_id;
  if (ev.city_id) return ev.city_id === studentCityId;
  // national/state with no concrete narrowing applies to everyone.
  return true;
}

/* ═══════════════════════════ ADMIN — question bank ═══════════════════════════ */

const createQuestionSchema = z.object({
  question_en: z.string().min(1).max(2000),
  question_hi: z.string().max(2000).optional(),
  scope: z.enum(QUIZ_SCOPES).default("national"),
  city_id: z.string().uuid().optional(),
  options: z
    .array(z.object({ text_en: z.string().min(1).max(1000), text_hi: z.string().max(1000).optional() }))
    .min(2)
    .max(10),
  correct_indices: z.array(z.coerce.number().int().min(0)).min(1),
  difficulty: z.string().max(40).default("medium"),
  age_groups: z.array(z.enum(["bal", "kishor", "tarun", "yuva"])).default([]),
  topic: z.string().max(120).optional(),
  source: z.string().max(120).default("manual"),
});

/* POST /v1/quizzes/questions — add a question to the bank (admin panel) */
router.post("/questions", async (req: Request, res: Response) => {
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

  // correct_indices must reference real options.
  for (const idx of body.correct_indices) {
    if (idx >= body.options.length) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "A correct index is out of range.");
      return;
    }
  }

  // city-scoped questions: the chosen city must be in the caller's city scope.
  const cityIds = await cityScopeForUser(req.authUser!);
  if (body.city_id && !cityInScope(cityIds, body.city_id)) {
    fail(res, 403, "ERR_FORBIDDEN", "City not in your scope.");
    return;
  }

  const [row] = await db
    .insert(questions)
    .values({
      scope: body.scope,
      city_id: body.city_id ?? null,
      question_en: body.question_en,
      question_hi: body.question_hi ?? null,
      options: body.options.map((o) => ({ text_en: o.text_en, text_hi: o.text_hi })),
      correct_indices: body.correct_indices,
      difficulty: body.difficulty,
      age_groups: body.age_groups,
      topic: body.topic ?? null,
      source: body.source,
      created_by: req.authUser!.id,
    })
    .returning({ id: questions.id });

  ok(res, { id: row.id });
});

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/* GET /v1/quizzes/questions?limit= — scoped question bank (admin panel) */
router.get("/questions", async (req: Request, res: Response) => {
  if (!canAccessAdminPanel(req.authUser?.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Admin panel access required.");
    return;
  }
  const cityIds = await cityScopeForUser(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);

  // super_admin (null) sees all; otherwise show national/state (city-agnostic)
  // plus questions whose city_id is in scope. cityIds === [] => only the former.
  let whereClause;
  if (cityIds === null) {
    whereClause = undefined;
  } else if (cityIds.length === 0) {
    whereClause = isNull(questions.city_id);
  } else {
    whereClause = or(isNull(questions.city_id), inArray(questions.city_id, cityIds));
  }

  const rows = await db
    .select({
      id: questions.id,
      scope: questions.scope,
      city_id: questions.city_id,
      question_en: questions.question_en,
      question_hi: questions.question_hi,
      options: questions.options,
      correct_indices: questions.correct_indices,
      difficulty: questions.difficulty,
      age_groups: questions.age_groups,
      topic: questions.topic,
      source: questions.source,
      is_active: questions.is_active,
      created_at: questions.created_at,
    })
    .from(questions)
    .where(whereClause)
    .orderBy(sql`${questions.created_at} desc`)
    .limit(limit);

  const items = rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
  ok(res, { items }, { count: items.length });
});

/* ═══════════════════════════ ADMIN — scheduled events ═══════════════════════════ */

const createEventSchema = z
  .object({
    title_en: z.string().min(1).max(300),
    title_hi: z.string().max(300).optional(),
    scope: z.enum(QUIZ_SCOPES),
    city_id: z.string().uuid().optional(),
    centre_id: z.string().uuid().optional(),
    batch_id: z.string().uuid().optional(),
    start_at: z.string().datetime(),
    end_at: z.string().datetime(),
    participation_points: z.coerce.number().int().min(0).max(10000).default(0),
    win_points: z.coerce.number().int().min(0).max(10000).default(0),
    age_groups: z.array(z.enum(["bal", "kishor", "tarun", "yuva"])).default([]),
    question_ids: z.array(z.string().uuid()).min(1).max(100),
  })
  .refine((b) => new Date(b.end_at) > new Date(b.start_at), { message: "end_at must be after start_at" });

/* POST /v1/quizzes/events — create an event + its question links (admin panel) */
router.post("/events", async (req: Request, res: Response) => {
  if (!canAccessAdminPanel(req.authUser?.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Admin panel access required.");
    return;
  }
  let body: z.infer<typeof createEventSchema>;
  try {
    body = createEventSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid event data.");
    return;
  }

  const cityIds = await cityScopeForUser(req.authUser!);

  // Resolve the event's effective city for scope-guarding. A centre/batch
  // implies a city; an explicit city_id is honoured directly.
  let effectiveCity: string | null = body.city_id ?? null;
  if (body.batch_id) {
    const [b] = await db
      .select({ centre_id: batches.centre_id })
      .from(batches)
      .where(eq(batches.id, body.batch_id))
      .limit(1);
    if (!b) {
      fail(res, 404, "ERR_NOT_FOUND", "Batch not found.");
      return;
    }
    effectiveCity = await cityForCentre(b.centre_id);
  } else if (body.centre_id) {
    effectiveCity = await cityForCentre(body.centre_id);
  }

  if (effectiveCity && !cityInScope(cityIds, effectiveCity)) {
    fail(res, 403, "ERR_FORBIDDEN", "Target not in your scope.");
    return;
  }
  // A non-super admin must not create a city-agnostic (national/state w/o city) event.
  if (!effectiveCity && cityIds !== null) {
    fail(res, 403, "ERR_FORBIDDEN", "Specify a city, centre, or batch in your scope.");
    return;
  }

  // All referenced questions must exist and be within the caller's city scope.
  const qRows = await db
    .select({ id: questions.id, city_id: questions.city_id })
    .from(questions)
    .where(inArray(questions.id, body.question_ids));
  if (qRows.length !== new Set(body.question_ids).size) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "One or more questions do not exist.");
    return;
  }
  for (const q of qRows) {
    if (q.city_id && !cityInScope(cityIds, q.city_id)) {
      fail(res, 403, "ERR_FORBIDDEN", "A selected question is outside your scope.");
      return;
    }
  }

  const [event] = await db
    .insert(quiz_events)
    .values({
      scope: body.scope,
      city_id: effectiveCity,
      centre_id: body.centre_id ?? null,
      batch_id: body.batch_id ?? null,
      title_en: body.title_en,
      title_hi: body.title_hi ?? null,
      start_at: new Date(body.start_at),
      end_at: new Date(body.end_at),
      participation_points: body.participation_points,
      win_points: body.win_points,
      age_groups: body.age_groups,
      created_by: req.authUser!.id,
    })
    .returning({ id: quiz_events.id });

  // Preserve the submitted question order via order_index.
  const seen = new Set<string>();
  const links: { quiz_event_id: string; question_id: string; order_index: number }[] = [];
  body.question_ids.forEach((qid, i) => {
    if (seen.has(qid)) return;
    seen.add(qid);
    links.push({ quiz_event_id: event.id, question_id: qid, order_index: i });
  });
  await db.insert(quiz_event_questions).values(links);

  await auditFromReq(req, {
    action: "create",
    entityKind: "quiz_event",
    entityId: event.id,
    summary: `Created quiz event "${body.title_en}"`,
  });

  ok(res, { id: event.id });
});

/* GET /v1/quizzes/events?limit= — scoped list of events (admin panel) */
router.get("/events", async (req: Request, res: Response) => {
  if (!canAccessAdminPanel(req.authUser?.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Admin panel access required.");
    return;
  }
  const cityIds = await cityScopeForUser(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);

  let whereClause;
  if (cityIds === null) {
    whereClause = undefined;
  } else if (cityIds.length === 0) {
    whereClause = isNull(quiz_events.city_id);
  } else {
    whereClause = or(isNull(quiz_events.city_id), inArray(quiz_events.city_id, cityIds));
  }

  const rows = await db
    .select({
      id: quiz_events.id,
      scope: quiz_events.scope,
      city_id: quiz_events.city_id,
      centre_id: quiz_events.centre_id,
      batch_id: quiz_events.batch_id,
      title_en: quiz_events.title_en,
      title_hi: quiz_events.title_hi,
      start_at: quiz_events.start_at,
      end_at: quiz_events.end_at,
      participation_points: quiz_events.participation_points,
      win_points: quiz_events.win_points,
      question_count: sql<number>`count(${quiz_event_questions.id})::int`,
      created_at: quiz_events.created_at,
    })
    .from(quiz_events)
    .leftJoin(quiz_event_questions, eq(quiz_event_questions.quiz_event_id, quiz_events.id))
    .where(whereClause)
    .groupBy(quiz_events.id)
    .orderBy(sql`${quiz_events.start_at} desc`)
    .limit(limit);

  const items = rows.map((r) => ({
    ...r,
    start_at: r.start_at.toISOString(),
    end_at: r.end_at.toISOString(),
    created_at: r.created_at.toISOString(),
  }));
  ok(res, { items }, { count: items.length });
});

/* ═══════════════════════════ STUDENT — event take flow ═══════════════════════════ */

const startEventSchema = z.object({ student_id: z.string().uuid() });

/* GET /v1/quizzes/events/available?student_id= — open events for a student */
router.get("/events/available", async (req: Request, res: Response) => {
  const parsed = z.object({ student_id: z.string().uuid() }).safeParse(req.query);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "A valid student_id is required.");
    return;
  }
  const student = await ownedStudent(req, parsed.data.student_id);
  if (!student) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }
  const studentCity = await cityForCentre(student.centre_id);

  const now = new Date();
  const rows = await db
    .select({
      id: quiz_events.id,
      scope: quiz_events.scope,
      city_id: quiz_events.city_id,
      centre_id: quiz_events.centre_id,
      batch_id: quiz_events.batch_id,
      title_en: quiz_events.title_en,
      title_hi: quiz_events.title_hi,
      start_at: quiz_events.start_at,
      end_at: quiz_events.end_at,
      participation_points: quiz_events.participation_points,
      win_points: quiz_events.win_points,
      age_groups: quiz_events.age_groups,
    })
    .from(quiz_events)
    .where(and(lte(quiz_events.start_at, now), gte(quiz_events.end_at, now)))
    .orderBy(asc(quiz_events.end_at));

  const matching = rows.filter((ev) => eventMatchesStudent(ev, student, studentCity));

  // already_attempted flag per event.
  const ids = matching.map((m) => m.id);
  const attempted = ids.length
    ? await db
        .select({ quiz_event_id: quiz_attempts.quiz_event_id })
        .from(quiz_attempts)
        .where(and(inArray(quiz_attempts.quiz_event_id, ids), eq(quiz_attempts.student_id, student.id)))
    : [];
  const attemptedSet = new Set(attempted.map((a) => a.quiz_event_id));

  const items = matching.map((m) => ({
    id: m.id,
    scope: m.scope,
    title_en: m.title_en,
    title_hi: m.title_hi,
    start_at: m.start_at.toISOString(),
    end_at: m.end_at.toISOString(),
    participation_points: m.participation_points,
    win_points: m.win_points,
    already_attempted: attemptedSet.has(m.id),
  }));
  ok(res, { items }, { count: items.length });
});

/** Load an event's ordered questions WITHOUT correct_indices (student-safe). */
async function loadEventQuestionsForStudent(eventId: string) {
  const rows = await db
    .select({
      id: questions.id,
      question_en: questions.question_en,
      question_hi: questions.question_hi,
      options: questions.options,
      order_index: quiz_event_questions.order_index,
    })
    .from(quiz_event_questions)
    .innerJoin(questions, eq(questions.id, quiz_event_questions.question_id))
    .where(eq(quiz_event_questions.quiz_event_id, eventId))
    .orderBy(asc(quiz_event_questions.order_index));
  return rows.map((r) => ({
    id: r.id,
    question_en: r.question_en,
    question_hi: r.question_hi,
    options: r.options, // {text_en, text_hi?}[] — no correct_indices
  }));
}

/* POST /v1/quizzes/events/:id/start — open an attempt, return safe questions */
router.post("/events/:id/start", async (req: Request, res: Response) => {
  let body: z.infer<typeof startEventSchema>;
  try {
    body = startEventSchema.parse(req.body ?? {});
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid start payload.");
    return;
  }
  const student = await ownedStudent(req, body.student_id);
  if (!student) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }

  const eventId = String(req.params.id);
  const [event] = await db.select().from(quiz_events).where(eq(quiz_events.id, eventId)).limit(1);
  if (!event) {
    fail(res, 404, "ERR_NOT_FOUND", "Quiz event not found.");
    return;
  }

  // Age-group targeting: a targeted event (non-empty age_groups) only admits
  // students whose age_group is listed. Surface this as a distinct 422.
  if (
    event.age_groups.length > 0 &&
    !(student.age_group && event.age_groups.includes(student.age_group))
  ) {
    fail(res, 422, "ERR_NOT_ELIGIBLE", "This quiz is not available for this student's age group.");
    return;
  }

  const studentCity = await cityForCentre(student.centre_id);
  if (!eventMatchesStudent(event, student, studentCity)) {
    fail(res, 403, "ERR_FORBIDDEN", "This quiz is not available for this student.");
    return;
  }

  const now = new Date();
  if (now < event.start_at || now > event.end_at) {
    fail(res, 422, "ERR_WINDOW_CLOSED", "The quiz window is not open.");
    return;
  }

  // Already attempted? (unique on (event, student)).
  const [existing] = await db
    .select({ id: quiz_attempts.id, submitted_at: quiz_attempts.submitted_at })
    .from(quiz_attempts)
    .where(and(eq(quiz_attempts.quiz_event_id, eventId), eq(quiz_attempts.student_id, student.id)))
    .limit(1);
  if (existing) {
    fail(res, 409, "ERR_ALREADY_ATTEMPTED", "This quiz has already been started.");
    return;
  }

  const eventQuestions = await loadEventQuestionsForStudent(eventId);

  const [attempt] = await db
    .insert(quiz_attempts)
    .values({
      quiz_event_id: eventId,
      student_id: student.id,
      started_at: now,
      total_count: eventQuestions.length,
    })
    .returning({ id: quiz_attempts.id });

  ok(res, { attempt_id: attempt.id, questions: eventQuestions });
});

const submitEventSchema = z.object({
  student_id: z.string().uuid(),
  answers: z.record(z.string(), z.array(z.coerce.number().int().min(0))).default({}),
});

/* POST /v1/quizzes/events/:id/submit — grade, persist, award points (idempotent) */
router.post("/events/:id/submit", async (req: Request, res: Response) => {
  let body: z.infer<typeof submitEventSchema>;
  try {
    body = submitEventSchema.parse(req.body ?? {});
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid submit payload.");
    return;
  }
  const student = await ownedStudent(req, body.student_id);
  if (!student) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }

  const eventId = String(req.params.id);
  const [event] = await db.select().from(quiz_events).where(eq(quiz_events.id, eventId)).limit(1);
  if (!event) {
    fail(res, 404, "ERR_NOT_FOUND", "Quiz event not found.");
    return;
  }

  const now = new Date();
  if (now < event.start_at || now > event.end_at) {
    fail(res, 422, "ERR_WINDOW_CLOSED", "The quiz window is not open.");
    return;
  }

  const [attempt] = await db
    .select({
      id: quiz_attempts.id,
      student_id: quiz_attempts.student_id,
      submitted_at: quiz_attempts.submitted_at,
    })
    .from(quiz_attempts)
    .where(and(eq(quiz_attempts.quiz_event_id, eventId), eq(quiz_attempts.student_id, student.id)))
    .limit(1);
  if (!attempt) {
    fail(res, 404, "ERR_NOT_FOUND", "No attempt found — start the quiz first.");
    return;
  }
  // IDEMPOTENT guard: already submitted => do not re-grade or re-award.
  if (attempt.submitted_at) {
    fail(res, 409, "ERR_ALREADY_SUBMITTED", "This quiz was already submitted.");
    return;
  }

  // Load the correct answers for grading.
  const qRows = await db
    .select({ id: questions.id, correct_indices: questions.correct_indices })
    .from(quiz_event_questions)
    .innerJoin(questions, eq(questions.id, quiz_event_questions.question_id))
    .where(eq(quiz_event_questions.quiz_event_id, eventId));

  const totalCount = qRows.length;
  let correctCount = 0;
  for (const q of qRows) {
    const selected = body.answers[q.id] ?? [];
    if (sameIndexSet(selected, q.correct_indices)) correctCount += 1;
  }
  const allCorrect = totalCount > 0 && correctCount === totalCount;
  const score = correctCount;

  // Atomic submit: serialize on the attempt id, then conditionally claim the
  // attempt by setting submitted_at ONLY if it is still null. Points are awarded
  // exclusively on the winning transition, so two concurrent submits (or a
  // re-submit that slipped past the read-time guard above) can never
  // double-award. `db.transaction` keeps grade-claim-award on one connection.
  const claimed = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${attempt.id}::text, 0))`);
    const rows = await tx
      .update(quiz_attempts)
      .set({
        submitted_at: now,
        score,
        correct_count: correctCount,
        total_count: totalCount,
        answers: body.answers,
      })
      .where(and(eq(quiz_attempts.id, attempt.id), isNull(quiz_attempts.submitted_at)))
      .returning({ id: quiz_attempts.id });
    return rows.length > 0;
  });

  // Lost the race / already submitted by a concurrent request: do not re-award.
  if (!claimed) {
    fail(res, 409, "ERR_ALREADY_SUBMITTED", "This quiz was already submitted.");
    return;
  }

  // Award participation once; win bonus only when every question is correct.
  // Reached only on the winning claim above, so awards happen exactly once.
  let pointsAwarded = 0;
  if (event.participation_points > 0) {
    await awardPunya({
      studentId: student.id,
      featureKey: "quiz",
      points: event.participation_points,
      note: `Quiz participation: ${event.title_en}`,
    });
    pointsAwarded += event.participation_points;
  }
  if (allCorrect && event.win_points > 0) {
    await awardPunya({
      studentId: student.id,
      featureKey: "quiz",
      points: event.win_points,
      note: `Quiz win: ${event.title_en}`,
    });
    pointsAwarded += event.win_points;
  }

  ok(res, {
    attempt_id: attempt.id,
    score,
    correct_count: correctCount,
    total_count: totalCount,
    all_correct: allCorrect,
    points_awarded: pointsAwarded,
  });
});

/* ═══════════════════════════ PUSH QUIZZES — live, batch-scoped ═══════════════════════════ */

const createPushSchema = z
  .object({
    batch_id: z.string().uuid(),
    expires_at: z.string().datetime(),
    completion_points: z.coerce.number().int().min(0).max(10000).default(0),
    questions: z
      .array(
        z.object({
          question_en: z.string().min(1).max(2000),
          question_hi: z.string().max(2000).optional(),
          options: z
            .array(z.object({ text_en: z.string().min(1).max(1000), text_hi: z.string().max(1000).optional() }))
            .min(2)
            .max(10),
          correct_indices: z.array(z.coerce.number().int().min(0)).min(1),
        }),
      )
      .min(1)
      .max(50),
  })
  .refine((b) => new Date(b.expires_at) > new Date(), { message: "expires_at must be in the future" });

/** Does this user (admin-panel) have authority over the given batch's centre? */
async function batchInAdminScope(user: User, centreId: string): Promise<boolean> {
  const scope = await resolveAdminScope(user);
  if (scope.centreIds === null) return true;
  return scope.centreIds.includes(centreId);
}

/* POST /v1/quizzes/push — shikshak/admin starts a live push quiz for a batch */
router.post("/push", async (req: Request, res: Response) => {
  if (!canAccessAdminPanel(req.authUser?.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Admin panel access required.");
    return;
  }
  let body: z.infer<typeof createPushSchema>;
  try {
    body = createPushSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid push quiz data.");
    return;
  }

  // Each question's correct_indices must reference real options.
  for (const q of body.questions) {
    for (const idx of q.correct_indices) {
      if (idx >= q.options.length) {
        fail(res, 422, "ERR_VALIDATION_FAILED", "A correct index is out of range.");
        return;
      }
    }
  }

  const [batch] = await db
    .select({ id: batches.id, centre_id: batches.centre_id })
    .from(batches)
    .where(eq(batches.id, body.batch_id))
    .limit(1);
  if (!batch) {
    fail(res, 404, "ERR_NOT_FOUND", "Batch not found.");
    return;
  }
  if (!(await batchInAdminScope(req.authUser!, batch.centre_id))) {
    fail(res, 404, "ERR_NOT_FOUND", "Batch not found.");
    return;
  }

  const [pq] = await db
    .insert(push_quizzes)
    .values({
      batch_id: batch.id,
      shikshak_user_id: req.authUser!.id,
      started_at: new Date(),
      expires_at: new Date(body.expires_at),
      completion_points: body.completion_points,
    })
    .returning({ id: push_quizzes.id });

  await db.insert(push_quiz_questions).values(
    body.questions.map((q, i) => ({
      push_quiz_id: pq.id,
      question_en: q.question_en,
      question_hi: q.question_hi ?? null,
      options: q.options.map((o) => ({ text_en: o.text_en, text_hi: o.text_hi })),
      correct_indices: q.correct_indices,
      order_index: i,
    })),
  );

  await auditFromReq(req, {
    action: "create",
    entityKind: "push_quiz",
    entityId: pq.id,
    summary: `Started push quiz for batch ${batch.id}`,
  });

  ok(res, { id: pq.id });
});

/* GET /v1/quizzes/push/active?student_id=&batch_id= — active push quiz (safe) */
router.get("/push/active", async (req: Request, res: Response) => {
  const parsed = z
    .object({ student_id: z.string().uuid(), batch_id: z.string().uuid().optional() })
    .safeParse(req.query);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "A valid student_id is required.");
    return;
  }
  const student = await ownedStudent(req, parsed.data.student_id);
  if (!student) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }

  // Derive the batch from the student unless an explicit (matching) one is given.
  const batchId = parsed.data.batch_id ?? student.batch_id;
  if (!batchId || (parsed.data.batch_id && parsed.data.batch_id !== student.batch_id)) {
    ok(res, { active: null });
    return;
  }

  const now = new Date();
  const [pq] = await db
    .select({
      id: push_quizzes.id,
      batch_id: push_quizzes.batch_id,
      started_at: push_quizzes.started_at,
      expires_at: push_quizzes.expires_at,
      completion_points: push_quizzes.completion_points,
    })
    .from(push_quizzes)
    .where(and(eq(push_quizzes.batch_id, batchId), gte(push_quizzes.expires_at, now)))
    .orderBy(sql`${push_quizzes.started_at} desc`)
    .limit(1);
  if (!pq) {
    ok(res, { active: null });
    return;
  }

  const qRows = await db
    .select({
      id: push_quiz_questions.id,
      question_en: push_quiz_questions.question_en,
      question_hi: push_quiz_questions.question_hi,
      options: push_quiz_questions.options,
      order_index: push_quiz_questions.order_index,
    })
    .from(push_quiz_questions)
    .where(eq(push_quiz_questions.push_quiz_id, pq.id))
    .orderBy(asc(push_quiz_questions.order_index));

  const [attempt] = await db
    .select({ id: push_quiz_attempts.id, submitted_at: push_quiz_attempts.submitted_at })
    .from(push_quiz_attempts)
    .where(and(eq(push_quiz_attempts.push_quiz_id, pq.id), eq(push_quiz_attempts.student_id, student.id)))
    .limit(1);

  ok(res, {
    active: {
      id: pq.id,
      started_at: pq.started_at.toISOString(),
      expires_at: pq.expires_at.toISOString(),
      completion_points: pq.completion_points,
      already_submitted: !!attempt?.submitted_at,
      questions: qRows.map((q) => ({
        id: q.id,
        question_en: q.question_en,
        question_hi: q.question_hi,
        options: q.options, // {text_en, text_hi?}[] — no correct_indices
      })),
    },
  });
});

const submitPushSchema = z.object({
  student_id: z.string().uuid(),
  answers: z.record(z.string(), z.array(z.coerce.number().int().min(0))).default({}),
});

/* POST /v1/quizzes/push/:id/submit — grade, persist, award once (idempotent) */
router.post("/push/:id/submit", async (req: Request, res: Response) => {
  let body: z.infer<typeof submitPushSchema>;
  try {
    body = submitPushSchema.parse(req.body ?? {});
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid submit payload.");
    return;
  }
  const student = await ownedStudent(req, body.student_id);
  if (!student) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }

  const pushId = String(req.params.id);
  const [pq] = await db
    .select({
      id: push_quizzes.id,
      batch_id: push_quizzes.batch_id,
      expires_at: push_quizzes.expires_at,
      completion_points: push_quizzes.completion_points,
    })
    .from(push_quizzes)
    .where(eq(push_quizzes.id, pushId))
    .limit(1);
  if (!pq) {
    fail(res, 404, "ERR_NOT_FOUND", "Push quiz not found.");
    return;
  }
  // The student must belong to this push quiz's batch.
  if (student.batch_id !== pq.batch_id) {
    fail(res, 403, "ERR_FORBIDDEN", "This quiz is not for the student's batch.");
    return;
  }

  const now = new Date();
  if (now > pq.expires_at) {
    fail(res, 422, "ERR_WINDOW_CLOSED", "This push quiz has expired.");
    return;
  }

  // IDEMPOTENT guard via the unique (push_quiz, student) constraint: if a
  // submitted attempt exists, refuse to re-award.
  const [existing] = await db
    .select({ id: push_quiz_attempts.id, submitted_at: push_quiz_attempts.submitted_at })
    .from(push_quiz_attempts)
    .where(and(eq(push_quiz_attempts.push_quiz_id, pushId), eq(push_quiz_attempts.student_id, student.id)))
    .limit(1);
  if (existing?.submitted_at) {
    fail(res, 409, "ERR_ALREADY_SUBMITTED", "You have already submitted this quiz.");
    return;
  }

  const qRows = await db
    .select({ id: push_quiz_questions.id, correct_indices: push_quiz_questions.correct_indices })
    .from(push_quiz_questions)
    .where(eq(push_quiz_questions.push_quiz_id, pushId));

  let correctCount = 0;
  for (const q of qRows) {
    const selected = body.answers[q.id] ?? [];
    if (sameIndexSet(selected, q.correct_indices)) correctCount += 1;
  }
  const score = correctCount;

  // Atomic submit: serialize on (push quiz, student), then upsert the attempt
  // but only let the update fire when the existing row has NOT been submitted
  // yet (setWhere: submitted_at IS NULL). `.returning()` yields a row ONLY on
  // the winning transition (fresh insert, or update of a not-yet-submitted row);
  // a conflict against an already-submitted row updates nothing and returns [].
  // Completion points are awarded exclusively on that winning transition, so two
  // concurrent submits can never double-award.
  const claimed = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${pushId + ":" + student.id}::text, 0))`,
    );
    const rows = await tx
      .insert(push_quiz_attempts)
      .values({ push_quiz_id: pushId, student_id: student.id, answers: body.answers, score, submitted_at: now })
      .onConflictDoUpdate({
        target: [push_quiz_attempts.push_quiz_id, push_quiz_attempts.student_id],
        set: { answers: body.answers, score, submitted_at: now },
        setWhere: isNull(push_quiz_attempts.submitted_at),
      })
      .returning({ id: push_quiz_attempts.id });
    return rows.length > 0;
  });

  // Lost the race / already submitted by a concurrent request: do not re-award.
  if (!claimed) {
    fail(res, 409, "ERR_ALREADY_SUBMITTED", "You have already submitted this quiz.");
    return;
  }

  // Reached only on the winning claim above, so completion points award once.
  let pointsAwarded = 0;
  if (pq.completion_points > 0) {
    await awardPunya({
      studentId: student.id,
      featureKey: "push_quiz",
      points: pq.completion_points,
      note: "Push quiz completion",
    });
    pointsAwarded = pq.completion_points;
  }

  ok(res, {
    push_quiz_id: pushId,
    score,
    correct_count: correctCount,
    total_count: qRows.length,
    points_awarded: pointsAwarded,
  });
});

export default router;
