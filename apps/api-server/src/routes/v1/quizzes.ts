/**
 * /v1/quizzes — quiz system: a shared question bank, scheduled quiz events, and
 * shikshak-initiated live "push" quizzes. Polling-based (no websockets).
 *
 * router.use(requireAuth): every route needs a logged-in user. Admin-panel
 * authoring/listing routes additionally gate with requireAdminPanel; the
 * student take-flow routes resolve + verify ownership of the student id passed.
 *
 * Question bank, scheduled events, and push quizzes support national→batch
 * scope with multi-select targets, gated by the creator's admin access.
 *
 * Grading: an answer for a question is correct iff the SET of selected indices
 * equals the SET of that question's correct_indices (order-independent).
 * score = correct_count. Point awards are idempotent — guarded on submitted_at so
 * re-calling submit never double-awards.
 */
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope } from "../../lib/scope";
import { awardPunya, reversePunya } from "../../lib/punya";
import {
  QUIZ_PARTICIPATION_FEATURE_KEY,
  QUIZ_WIN_FEATURE_KEY,
  PUSH_QUIZ_COMPLETION_FEATURE_KEY,
  resolveQuizParticipationPoints,
  resolveQuizWinPoints,
  resolvePushQuizCompletionPoints,
} from "../../lib/quiz-points";
import { quizMatchesStudent, quizMatchesStudentSql } from "../../lib/quiz-scope";
import { auditFromReq } from "../../lib/audit";
import { clampLimit } from "../../lib/route-helpers";
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
  states,
  type User,
} from "@workspace/db";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { canAccessAdminPanel } from "@workspace/api-zod";
import { Router, type IRouter, type Request, type Response } from "express";

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

/** City + state for a centre (student geography). */
async function geoForCentre(centreId: string | null): Promise<{ city_id: string | null; state_id: string | null }> {
  if (!centreId) return { city_id: null, state_id: null };
  const [row] = await db
    .select({ city_id: centres.city_id, state_id: centres.state_id })
    .from(centres)
    .where(eq(centres.id, centreId))
    .limit(1);
  return { city_id: row?.city_id ?? null, state_id: row?.state_id ?? null };
}

type QuizScope = (typeof QUIZ_SCOPES)[number];

function uniqIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
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

function targetsForScope(
  scope: QuizScope,
  input: {
    state_ids?: string[];
    city_ids?: string[];
    centre_ids?: string[];
    batch_ids?: string[];
    city_id?: string;
    centre_id?: string;
    batch_id?: string;
  },
): { state_ids: string[]; city_ids: string[]; centre_ids: string[]; batch_ids: string[] } {
  const city_ids = uniqIds([...(input.city_ids ?? []), ...(input.city_id ? [input.city_id] : [])]);
  const centre_ids = uniqIds([...(input.centre_ids ?? []), ...(input.centre_id ? [input.centre_id] : [])]);
  const batch_ids = uniqIds([...(input.batch_ids ?? []), ...(input.batch_id ? [input.batch_id] : [])]);
  const state_ids = uniqIds([...(input.state_ids ?? [])]);
  if (scope === "national") return { state_ids: [], city_ids: [], centre_ids: [], batch_ids: [] };
  if (scope === "state") return { state_ids, city_ids: [], centre_ids: [], batch_ids: [] };
  if (scope === "city") return { state_ids: [], city_ids, centre_ids: [], batch_ids: [] };
  if (scope === "centre") return { state_ids: [], city_ids: [], centre_ids, batch_ids: [] };
  return { state_ids: [], city_ids: [], centre_ids: [], batch_ids };
}

function allowedQuizScopes(role: string): QuizScope[] {
  if (role === "super_admin") return [...QUIZ_SCOPES];
  if (role === "state_admin") return ["state", "city", "centre", "batch"];
  if (role === "city_admin") return ["city", "centre", "batch"];
  return ["centre", "batch"];
}

/**
 * Validate multi-select targets against the creator's access. Returns an error
 * message or null when OK. Also returns normalized targets.
 */
async function authorizeQuizTargets(
  user: User,
  scope: QuizScope,
  raw: {
    state_ids?: string[];
    city_ids?: string[];
    centre_ids?: string[];
    batch_ids?: string[];
    city_id?: string;
    centre_id?: string;
    batch_id?: string;
  },
): Promise<{ error: string | null; targets: ReturnType<typeof targetsForScope> }> {
  if (!allowedQuizScopes(user.role).includes(scope)) {
    return { error: `Your role cannot create ${scope}-scoped quizzes.`, targets: targetsForScope(scope, raw) };
  }
  const targets = targetsForScope(scope, raw);

  if (scope === "national") {
    if (user.role !== "super_admin") {
      return { error: "Only national admins can create national quizzes.", targets };
    }
    return { error: null, targets };
  }

  if (scope === "state") {
    if (targets.state_ids.length === 0) return { error: "Select at least one state.", targets };
    if (user.role === "super_admin") {
      const rows = await db.select({ id: states.id }).from(states).where(inArray(states.id, targets.state_ids));
      if (rows.length !== targets.state_ids.length) return { error: "One or more states were not found.", targets };
      return { error: null, targets };
    }
    if (user.role === "state_admin") {
      if (!user.state_id || targets.state_ids.some((id) => id !== user.state_id)) {
        return { error: "You can only target your own state.", targets };
      }
      return { error: null, targets };
    }
    return { error: "You cannot create state-scoped quizzes.", targets };
  }

  if (scope === "city") {
    if (targets.city_ids.length === 0) return { error: "Select at least one city.", targets };
    const cityIds = await cityScopeForUser(user);
    for (const id of targets.city_ids) {
      if (!cityInScope(cityIds, id)) return { error: "A selected city is outside your scope.", targets };
    }
    return { error: null, targets };
  }

  if (scope === "centre") {
    if (targets.centre_ids.length === 0) return { error: "Select at least one centre.", targets };
    const adminScope = await resolveAdminScope(user);
    if (adminScope.centreIds !== null) {
      for (const id of targets.centre_ids) {
        if (!adminScope.centreIds.includes(id)) return { error: "A selected centre is outside your scope.", targets };
      }
    }
    const rows = await db.select({ id: centres.id }).from(centres).where(and(inArray(centres.id, targets.centre_ids), isNull(centres.deleted_at)));
    if (rows.length !== targets.centre_ids.length) return { error: "One or more centres were not found.", targets };
    return { error: null, targets };
  }

  // batch
  if (targets.batch_ids.length === 0) return { error: "Select at least one batch.", targets };
  const batchRows = await db
    .select({ id: batches.id, centre_id: batches.centre_id })
    .from(batches)
    .where(inArray(batches.id, targets.batch_ids));
  if (batchRows.length !== targets.batch_ids.length) return { error: "One or more batches were not found.", targets };
  const adminScope = await resolveAdminScope(user);
  if (adminScope.centreIds !== null) {
    for (const b of batchRows) {
      if (!adminScope.centreIds.includes(b.centre_id)) {
        return { error: "A selected batch is outside your scope.", targets };
      }
    }
  }
  return { error: null, targets };
}

type QuizTargetRow = {
  scope: string;
  state_ids?: string[] | null;
  city_ids?: string[] | null;
  centre_ids?: string[] | null;
  batch_ids?: string[] | null;
  city_id?: string | null;
  centre_id?: string | null;
  batch_id?: string | null;
};

/** True when the admin may view results for this quiz (centre/batch write scope). */
async function quizTargetsInAdminScope(user: User, targets: QuizTargetRow): Promise<boolean> {
  const scope = await resolveAdminScope(user);
  if (scope.centreIds === null) return true;

  const stateIds = targets.state_ids?.length ? targets.state_ids : [];
  const cityIds = targets.city_ids?.length ? targets.city_ids : targets.city_id ? [targets.city_id] : [];
  const centreIds = targets.centre_ids?.length
    ? targets.centre_ids
    : targets.centre_id
      ? [targets.centre_id]
      : [];
  const batchIds = targets.batch_ids?.length ? targets.batch_ids : targets.batch_id ? [targets.batch_id] : [];

  switch (targets.scope) {
    case "national":
      return true;
    case "state": {
      if (stateIds.length === 0 || scope.centreIds.length === 0) return false;
      const rows = await db
        .select({ id: centres.id })
        .from(centres)
        .where(
          and(
            inArray(centres.state_id, stateIds),
            inArray(centres.id, scope.centreIds),
            isNull(centres.deleted_at),
          ),
        )
        .limit(1);
      return rows.length > 0;
    }
    case "city": {
      if (cityIds.length === 0 || scope.centreIds.length === 0) return false;
      const rows = await db
        .select({ id: centres.id })
        .from(centres)
        .where(
          and(
            inArray(centres.city_id, cityIds),
            inArray(centres.id, scope.centreIds),
            isNull(centres.deleted_at),
          ),
        )
        .limit(1);
      return rows.length > 0;
    }
    case "centre":
      return centreIds.some((id) => scope.centreIds!.includes(id));
    case "batch": {
      if (batchIds.length === 0) return false;
      if (scope.batchIds !== null) {
        return batchIds.some((id) => scope.batchIds!.includes(id));
      }
      const rows = await db
        .select({ centre_id: batches.centre_id })
        .from(batches)
        .where(inArray(batches.id, batchIds));
      return rows.some((b) => scope.centreIds!.includes(b.centre_id));
    }
    default:
      return false;
  }
}

/** Active students who match the quiz's geographic targets (eligible roster size). */
async function countEligibleStudents(targets: QuizTargetRow): Promise<number> {
  const stateIds = targets.state_ids?.length ? targets.state_ids : [];
  const cityIds = targets.city_ids?.length ? targets.city_ids : targets.city_id ? [targets.city_id] : [];
  const centreIds = targets.centre_ids?.length
    ? targets.centre_ids
    : targets.centre_id
      ? [targets.centre_id]
      : [];
  const batchIds = targets.batch_ids?.length ? targets.batch_ids : targets.batch_id ? [targets.batch_id] : [];

  const active = and(eq(students.status, "active"), isNull(students.deleted_at));

  if (targets.scope === "national") {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(students)
      .where(active);
    return row?.n ?? 0;
  }
  if (targets.scope === "batch" && batchIds.length) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(students)
      .where(and(active, inArray(students.batch_id, batchIds)));
    return row?.n ?? 0;
  }
  if (targets.scope === "centre" && centreIds.length) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(students)
      .where(and(active, inArray(students.centre_id, centreIds)));
    return row?.n ?? 0;
  }
  if (targets.scope === "city" && cityIds.length) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(students)
      .innerJoin(centres, eq(centres.id, students.centre_id))
      .where(and(active, inArray(centres.city_id, cityIds), isNull(centres.deleted_at)));
    return row?.n ?? 0;
  }
  if (targets.scope === "state" && stateIds.length) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(students)
      .innerJoin(centres, eq(centres.id, students.centre_id))
      .where(and(active, inArray(centres.state_id, stateIds), isNull(centres.deleted_at)));
    return row?.n ?? 0;
  }
  return 0;
}

/** Sum unreversed punya for a quiz/push attempt (source_entity_id + legacy idempotency keys). */
async function pointsAwardedForAttempt(attemptId: string): Promise<number> {
  const prefix = `quiz-award:${attemptId}`;
  const result = await db.execute(sql`
    select coalesce(sum(t.points), 0)::int as points
    from punya_transactions t
    where t.points > 0
      and (
        t.source_entity_id = ${attemptId}::uuid
        or t.idempotency_key = ${prefix}
        or (
          t.idempotency_key like ${prefix + ":%"}
          and t.idempotency_key not like ${"%:reversal"}
        )
      )
      and not exists (
        select 1 from punya_transactions r where r.reversal_of = t.id
      )
  `);
  const rows = (result as unknown as { rows?: Array<{ points: number }> }).rows ?? [];
  return rows[0]?.points ?? 0;
}

type QuizAwardRow = {
  id: string;
  points: number;
  idempotency_key: string | null;
  feature_key: string;
};

/** Unreversed quiz awards for an attempt — used by reset and force-delete. */
async function findUnreversedQuizAwards(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  attemptId: string,
  studentId: string,
): Promise<QuizAwardRow[]> {
  const prefix = `quiz-award:${attemptId}`;
  const result = await tx.execute(sql`
    select t.id, t.points, t.idempotency_key, t.feature_key
    from punya_transactions t
    where t.student_id = ${studentId}
      and t.points > 0
      and (
        t.source_entity_id = ${attemptId}::uuid
        or t.idempotency_key = ${prefix}
        or (
          t.idempotency_key like ${prefix + ":%"}
          and t.idempotency_key not like ${"%:reversal"}
        )
      )
      and not exists (
        select 1 from punya_transactions r where r.reversal_of = t.id
      )
  `);
  return (
    (result as unknown as { rows?: QuizAwardRow[] }).rows ?? []
  ).filter((r) => r.idempotency_key);
}

/**
 * Next award revision for an attempt. Reset reverses ledger rows but keeps the
 * original idempotency keys, so a retake must mint a new key or ON CONFLICT
 * silently skips the credit.
 */
async function nextQuizAwardRevision(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  attemptId: string,
  kind: "participation" | "win",
): Promise<number> {
  const legacy = `quiz-award:${attemptId}:${kind}`;
  const prefix = `quiz-award:${attemptId}:${kind}:`;
  const result = await tx.execute(sql`
    select count(*)::int as n
    from punya_transactions t
    where t.points > 0
      and (
        t.idempotency_key = ${legacy}
        or t.idempotency_key like ${prefix + "%"}
      )
      and t.idempotency_key not like ${"%:reversal"}
  `);
  const n = (result as unknown as { rows?: Array<{ n: number }> }).rows?.[0]?.n ?? 0;
  return Number(n) + 1;
}

function quizAwardIdempotencyKey(
  attemptId: string,
  kind: "participation" | "win",
  revision: number,
): string {
  // rev 1 keeps the historical key shape used before correction-path retakes.
  if (revision <= 1) return `quiz-award:${attemptId}:${kind}`;
  return `quiz-award:${attemptId}:${kind}:${revision}`;
}

async function reverseQuizAttemptAwards(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  attemptId: string,
  studentId: string,
  awardedBy: string | null,
): Promise<number> {
  const awards = await findUnreversedQuizAwards(tx, attemptId, studentId);
  let reversed = 0;
  for (const award of awards) {
    const key = award.idempotency_key!;
    const reversalKey = key.endsWith(":reversal") ? key : `${key}:reversal`;
    const rev = await reversePunya(
      {
        studentId,
        featureKey: award.feature_key,
        points: award.points,
        note: "Quiz attempt reset",
        awardedBy,
        idempotencyKey: reversalKey,
      },
      tx,
    );
    reversed += rev.points_reversed;
  }
  return reversed;
}

async function questionLinkedToAttemptedEvent(questionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: quiz_attempts.id })
    .from(quiz_event_questions)
    .innerJoin(quiz_attempts, eq(quiz_attempts.quiz_event_id, quiz_event_questions.quiz_event_id))
    .where(eq(quiz_event_questions.question_id, questionId))
    .limit(1);
  return !!row;
}

/** Effective legacy city_id for admin listing filters. */
async function primaryCityForTargets(
  scope: QuizScope,
  targets: ReturnType<typeof targetsForScope>,
): Promise<string | null> {
  if (scope === "city" && targets.city_ids[0]) return targets.city_ids[0];
  if (scope === "centre" && targets.centre_ids[0]) return cityForCentre(targets.centre_ids[0]);
  if (scope === "batch" && targets.batch_ids[0]) {
    const [b] = await db.select({ centre_id: batches.centre_id }).from(batches).where(eq(batches.id, targets.batch_ids[0])).limit(1);
    return b ? cityForCentre(b.centre_id) : null;
  }
  return null;
}

/* ═══════════════════════════ ADMIN — question bank ═══════════════════════════ */

const createQuestionSchema = z.object({
  question_en: z.string().min(1).max(2000),
  question_hi: z.string().max(2000).optional(),
  scope: z.enum(QUIZ_SCOPES).default("national"),
  state_ids: z.array(z.string().uuid()).default([]),
  city_ids: z.array(z.string().uuid()).default([]),
  centre_ids: z.array(z.string().uuid()).default([]),
  batch_ids: z.array(z.string().uuid()).default([]),
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

  const auth = await authorizeQuizTargets(req.authUser!, body.scope, body);
  if (auth.error) {
    fail(res, 403, "ERR_FORBIDDEN", auth.error);
    return;
  }
  const primaryCity = await primaryCityForTargets(body.scope, auth.targets);

  const [row] = await db
    .insert(questions)
    .values({
      scope: body.scope,
      state_ids: auth.targets.state_ids,
      city_ids: auth.targets.city_ids,
      centre_ids: auth.targets.centre_ids,
      batch_ids: auth.targets.batch_ids,
      city_id: primaryCity,
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


/* GET /v1/quizzes/questions?limit=&is_active= — scoped question bank (admin panel) */
router.get("/questions", async (req: Request, res: Response) => {
  if (!canAccessAdminPanel(req.authUser?.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Admin panel access required.");
    return;
  }
  const cityIds = await cityScopeForUser(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);
  const activeParam = typeof req.query.is_active === "string" ? req.query.is_active : "true";

  // super_admin (null) sees all; otherwise show national/state (city-agnostic)
  // plus questions whose city_id is in scope. cityIds === [] => only the former.
  const scopeParts = [];
  if (cityIds === null) {
    /* no city filter */
  } else if (cityIds.length === 0) {
    scopeParts.push(isNull(questions.city_id));
  } else {
    scopeParts.push(or(isNull(questions.city_id), inArray(questions.city_id, cityIds))!);
  }
  if (activeParam === "true") scopeParts.push(eq(questions.is_active, true));
  else if (activeParam === "false") scopeParts.push(eq(questions.is_active, false));
  // "all" → no is_active filter

  const whereClause = scopeParts.length === 0 ? undefined : and(...scopeParts);

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

const patchQuestionSchema = z.object({
  question_en: z.string().min(1).max(2000).optional(),
  question_hi: z.string().max(2000).nullable().optional(),
  options: z
    .array(z.object({ text_en: z.string().min(1).max(1000), text_hi: z.string().max(1000).optional() }))
    .min(2)
    .max(10)
    .optional(),
  correct_indices: z.array(z.coerce.number().int().min(0)).min(1).optional(),
  difficulty: z.string().max(40).optional(),
  age_groups: z.array(z.enum(["bal", "kishor", "tarun", "yuva"])).optional(),
  topic: z.string().max(120).nullable().optional(),
  is_active: z.boolean().optional(),
});

/* PATCH /v1/quizzes/questions/:id — edit bank question (blocked when attempts exist) */
router.patch("/questions/:id", requireAdminPanel, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  let body: z.infer<typeof patchQuestionSchema>;
  try {
    body = patchQuestionSchema.parse(req.body ?? {});
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid question data.");
    return;
  }
  if (Object.keys(body).length === 0) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "No fields to update.");
    return;
  }

  const [existing] = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
  if (!existing) {
    fail(res, 404, "ERR_NOT_FOUND", "Question not found.");
    return;
  }
  if (!(await quizTargetsInAdminScope(req.authUser!, existing))) {
    fail(res, 403, "ERR_FORBIDDEN", "This question is outside your scope.");
    return;
  }
  if (await questionLinkedToAttemptedEvent(id)) {
    fail(
      res,
      409,
      "ERR_QUESTION_IN_USE",
      "This question is on a quiz that already has attempts — deactivate it and author a new question instead.",
    );
    return;
  }

  const nextOptions = body.options ?? existing.options;
  const nextCorrect = body.correct_indices ?? existing.correct_indices;
  for (const idx of nextCorrect) {
    if (idx >= nextOptions.length) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "A correct index is out of range.");
      return;
    }
  }

  const [row] = await db
    .update(questions)
    .set({
      ...(body.question_en !== undefined ? { question_en: body.question_en } : {}),
      ...(body.question_hi !== undefined ? { question_hi: body.question_hi } : {}),
      ...(body.options !== undefined
        ? { options: body.options.map((o) => ({ text_en: o.text_en, text_hi: o.text_hi })) }
        : {}),
      ...(body.correct_indices !== undefined ? { correct_indices: body.correct_indices } : {}),
      ...(body.difficulty !== undefined ? { difficulty: body.difficulty } : {}),
      ...(body.age_groups !== undefined ? { age_groups: body.age_groups } : {}),
      ...(body.topic !== undefined ? { topic: body.topic } : {}),
      ...(body.is_active !== undefined ? { is_active: body.is_active } : {}),
      updated_at: new Date(),
    })
    .where(eq(questions.id, id))
    .returning({ id: questions.id, is_active: questions.is_active });

  await auditFromReq(req, {
    action: "update",
    entityKind: "question",
    entityId: id,
    summary: `Updated quiz question`,
  });

  ok(res, { id: row!.id, is_active: row!.is_active });
});

/* DELETE /v1/quizzes/questions/:id — soft-delete (is_active = false) */
router.delete("/questions/:id", requireAdminPanel, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [existing] = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
  if (!existing) {
    fail(res, 404, "ERR_NOT_FOUND", "Question not found.");
    return;
  }
  if (!(await quizTargetsInAdminScope(req.authUser!, existing))) {
    fail(res, 403, "ERR_FORBIDDEN", "This question is outside your scope.");
    return;
  }

  await db
    .update(questions)
    .set({ is_active: false, updated_at: new Date() })
    .where(eq(questions.id, id));

  await auditFromReq(req, {
    action: "delete",
    entityKind: "question",
    entityId: id,
    summary: "Soft-deleted quiz question (is_active = false)",
  });

  ok(res, { id, is_active: false });
});

/* ═══════════════════════════ ADMIN — scheduled events ═══════════════════════════ */

const createEventSchema = z
  .object({
    title_en: z.string().min(1).max(300),
    title_hi: z.string().max(300).optional(),
    scope: z.enum(QUIZ_SCOPES),
    state_ids: z.array(z.string().uuid()).default([]),
    city_ids: z.array(z.string().uuid()).default([]),
    centre_ids: z.array(z.string().uuid()).default([]),
    batch_ids: z.array(z.string().uuid()).default([]),
    city_id: z.string().uuid().optional(),
    centre_id: z.string().uuid().optional(),
    batch_id: z.string().uuid().optional(),
    start_at: z.string().datetime(),
    end_at: z.string().datetime(),
    // null/omit = punya_features default; 0 disables (AT21).
    participation_points: z.number().int().min(0).max(10000).nullish(),
    win_points: z.number().int().min(0).max(10000).nullish(),
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

  const auth = await authorizeQuizTargets(req.authUser!, body.scope, body);
  if (auth.error) {
    fail(res, 403, "ERR_FORBIDDEN", auth.error);
    return;
  }

  const cityIds = await cityScopeForUser(req.authUser!);
  const primaryCity = await primaryCityForTargets(body.scope, auth.targets);

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
      state_ids: auth.targets.state_ids,
      city_ids: auth.targets.city_ids,
      centre_ids: auth.targets.centre_ids,
      batch_ids: auth.targets.batch_ids,
      city_id: primaryCity,
      centre_id: auth.targets.centre_ids[0] ?? null,
      batch_id: auth.targets.batch_ids[0] ?? null,
      title_en: body.title_en,
      title_hi: body.title_hi ?? null,
      start_at: new Date(body.start_at),
      end_at: new Date(body.end_at),
      participation_points: body.participation_points ?? undefined,
      win_points: body.win_points ?? undefined,
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
      state_ids: quiz_events.state_ids,
      city_ids: quiz_events.city_ids,
      centre_ids: quiz_events.centre_ids,
      batch_ids: quiz_events.batch_ids,
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

/* GET /v1/quizzes/events/:id/attempts — admin results roster */
router.get("/events/:id/attempts", requireAdminPanel, async (req: Request, res: Response) => {
  const eventId = String(req.params.id);
  const [event] = await db.select().from(quiz_events).where(eq(quiz_events.id, eventId)).limit(1);
  if (!event) {
    fail(res, 404, "ERR_NOT_FOUND", "Quiz event not found.");
    return;
  }
  if (!(await quizTargetsInAdminScope(req.authUser!, event))) {
    fail(res, 403, "ERR_FORBIDDEN", "This quiz event is outside your scope.");
    return;
  }

  const qRows = await db
    .select({
      id: questions.id,
      correct_indices: questions.correct_indices,
      order_index: quiz_event_questions.order_index,
    })
    .from(quiz_event_questions)
    .innerJoin(questions, eq(questions.id, quiz_event_questions.question_id))
    .where(eq(quiz_event_questions.quiz_event_id, eventId))
    .orderBy(asc(quiz_event_questions.order_index));

  const attemptRows = await db
    .select({
      id: quiz_attempts.id,
      student_id: quiz_attempts.student_id,
      full_name: students.full_name,
      centre_name: centres.name,
      batch_name: batches.name,
      started_at: quiz_attempts.started_at,
      submitted_at: quiz_attempts.submitted_at,
      correct_count: quiz_attempts.correct_count,
      total_count: quiz_attempts.total_count,
      score: quiz_attempts.score,
      answers: quiz_attempts.answers,
    })
    .from(quiz_attempts)
    .innerJoin(students, eq(students.id, quiz_attempts.student_id))
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .leftJoin(batches, eq(batches.id, students.batch_id))
    .where(eq(quiz_attempts.quiz_event_id, eventId))
    .orderBy(asc(students.full_name));

  const items = [];
  for (const row of attemptRows) {
    const answers = (row.answers ?? {}) as Record<string, number[]>;
    const question_results = qRows.map((q) => ({
      question_id: q.id,
      correct: sameIndexSet(answers[q.id] ?? [], q.correct_indices),
    }));
    items.push({
      attempt_id: row.id,
      student_id: row.student_id,
      full_name: row.full_name,
      centre_name: row.centre_name,
      batch_name: row.batch_name,
      started_at: row.started_at.toISOString(),
      submitted_at: row.submitted_at ? row.submitted_at.toISOString() : null,
      correct_count: row.correct_count,
      total_count: row.total_count,
      score: row.score,
      points_awarded: await pointsAwardedForAttempt(row.id),
      question_results,
    });
  }

  const submitted = items.filter((i) => i.submitted_at);
  const scoreSum = submitted.reduce((acc, i) => acc + (i.score ?? 0), 0);
  const average_score = submitted.length ? scoreSum / submitted.length : 0;
  const eligible_count = await countEligibleStudents(event);

  ok(
    res,
    {
      items,
      attempted_count: items.length,
      submitted_count: submitted.length,
      eligible_count,
      average_score,
    },
    { count: items.length },
  );
});

/* POST /v1/quizzes/events/:id/attempts/:attemptId/reset — reverse Punya + clear submit */
router.post(
  "/events/:id/attempts/:attemptId/reset",
  requireAdminPanel,
  async (req: Request, res: Response) => {
    const eventId = String(req.params.id);
    const attemptId = String(req.params.attemptId);

    const [event] = await db.select().from(quiz_events).where(eq(quiz_events.id, eventId)).limit(1);
    if (!event) {
      fail(res, 404, "ERR_NOT_FOUND", "Quiz event not found.");
      return;
    }
    if (!(await quizTargetsInAdminScope(req.authUser!, event))) {
      fail(res, 403, "ERR_FORBIDDEN", "This quiz event is outside your scope.");
      return;
    }

    const [attempt] = await db
      .select({
        id: quiz_attempts.id,
        student_id: quiz_attempts.student_id,
        submitted_at: quiz_attempts.submitted_at,
      })
      .from(quiz_attempts)
      .where(and(eq(quiz_attempts.id, attemptId), eq(quiz_attempts.quiz_event_id, eventId)))
      .limit(1);
    if (!attempt) {
      fail(res, 404, "ERR_NOT_FOUND", "Attempt not found.");
      return;
    }

    const outcome = await db.transaction(async (tx) => {
      const points_reversed = await reverseQuizAttemptAwards(
        tx,
        attempt.id,
        attempt.student_id,
        req.authUser!.id,
      );
      await tx
        .update(quiz_attempts)
        .set({
          submitted_at: null,
          score: null,
          correct_count: null,
          total_count: null,
          answers: {},
          updated_at: new Date(),
        })
        .where(eq(quiz_attempts.id, attempt.id));
      return { points_reversed };
    });

    await auditFromReq(req, {
      action: "update",
      entityKind: "quiz_attempt",
      entityId: attemptId,
      summary: `Reset quiz attempt (reversed ${outcome.points_reversed} Punya)`,
      metadata: { event_id: eventId, points_reversed: outcome.points_reversed },
    });

    ok(res, {
      attempt_id: attemptId,
      points_reversed: outcome.points_reversed,
      reset: true,
    });
  },
);

/* DELETE /v1/quizzes/events/:id — delete event; force reverses awards when attempts exist */
router.delete("/events/:id", requireAdminPanel, async (req: Request, res: Response) => {
  const eventId = String(req.params.id);
  const force =
    (req.body && typeof req.body === "object" && (req.body as { force?: unknown }).force === true) ||
    req.query.force === "true";

  const [event] = await db.select().from(quiz_events).where(eq(quiz_events.id, eventId)).limit(1);
  if (!event) {
    fail(res, 404, "ERR_NOT_FOUND", "Quiz event not found.");
    return;
  }
  if (!(await quizTargetsInAdminScope(req.authUser!, event))) {
    fail(res, 403, "ERR_FORBIDDEN", "This quiz event is outside your scope.");
    return;
  }

  const submitted = await db
    .select({ id: quiz_attempts.id, student_id: quiz_attempts.student_id })
    .from(quiz_attempts)
    .where(and(eq(quiz_attempts.quiz_event_id, eventId), isNotNull(quiz_attempts.submitted_at)));

  if (submitted.length > 0 && !force) {
    fail(
      res,
      409,
      "ERR_EVENT_HAS_ATTEMPTS",
      "This quiz event has submitted attempts — pass force: true to reverse awards and delete.",
    );
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    let points_reversed = 0;
    const allAttempts = await tx
      .select({ id: quiz_attempts.id, student_id: quiz_attempts.student_id })
      .from(quiz_attempts)
      .where(eq(quiz_attempts.quiz_event_id, eventId));

    for (const att of allAttempts) {
      points_reversed += await reverseQuizAttemptAwards(tx, att.id, att.student_id, req.authUser!.id);
    }

    const attemptCount = allAttempts.length;
    await tx.delete(quiz_attempts).where(eq(quiz_attempts.quiz_event_id, eventId));
    await tx.delete(quiz_event_questions).where(eq(quiz_event_questions.quiz_event_id, eventId));
    await tx.delete(quiz_events).where(eq(quiz_events.id, eventId));
    return { attemptCount, points_reversed };
  });

  await auditFromReq(req, {
    action: "delete",
    entityKind: "quiz_event",
    entityId: eventId,
    summary: `Deleted quiz event (attempts=${outcome.attemptCount}, reversed=${outcome.points_reversed}, force=${!!force})`,
    metadata: {
      force: !!force,
      attempts_removed: outcome.attemptCount,
      points_reversed: outcome.points_reversed,
    },
  });

  ok(res, {
    id: eventId,
    deleted: true,
    attempts_removed: outcome.attemptCount,
    points_reversed: outcome.points_reversed,
  });
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
  const studentGeo = await geoForCentre(student.centre_id);

  const now = new Date();
  const matching = await db
    .select({
      id: quiz_events.id,
      scope: quiz_events.scope,
      title_en: quiz_events.title_en,
      title_hi: quiz_events.title_hi,
      start_at: quiz_events.start_at,
      end_at: quiz_events.end_at,
      participation_points: quiz_events.participation_points,
      win_points: quiz_events.win_points,
    })
    .from(quiz_events)
    .where(
      and(
        lte(quiz_events.start_at, now),
        gte(quiz_events.end_at, now),
        quizMatchesStudentSql(
          {
            scope: quiz_events.scope,
            state_ids: quiz_events.state_ids,
            city_ids: quiz_events.city_ids,
            centre_ids: quiz_events.centre_ids,
            batch_ids: quiz_events.batch_ids,
            city_id: quiz_events.city_id,
            centre_id: quiz_events.centre_id,
            batch_id: quiz_events.batch_id,
            age_groups: quiz_events.age_groups,
          },
          student,
          studentGeo.city_id,
          studentGeo.state_id,
        ),
      ),
    )
    .orderBy(asc(quiz_events.end_at))
    .limit(100);

  // Attempt outcome per event (for completed-state UI).
  const ids = matching.map((m) => m.id);
  const attempted = ids.length
    ? await db
        .select({
          quiz_event_id: quiz_attempts.quiz_event_id,
          correct_count: quiz_attempts.correct_count,
          total_count: quiz_attempts.total_count,
          submitted_at: quiz_attempts.submitted_at,
        })
        .from(quiz_attempts)
        .where(and(inArray(quiz_attempts.quiz_event_id, ids), eq(quiz_attempts.student_id, student.id)))
    : [];
  const attemptByEvent = new Map(attempted.map((a) => [a.quiz_event_id, a]));

  const items = matching.map((m) => {
    const att = attemptByEvent.get(m.id);
    const already_attempted = !!att?.submitted_at;
    const in_progress = !!att && !att.submitted_at;
    const is_winner =
      !!att?.submitted_at &&
      (att.total_count ?? 0) > 0 &&
      att.correct_count === att.total_count;
    let points_earned = 0;
    if (att?.submitted_at) {
      if ((m.participation_points ?? 0) > 0) points_earned += m.participation_points ?? 0;
      if (is_winner && (m.win_points ?? 0) > 0) points_earned += m.win_points ?? 0;
    }
    return {
      id: m.id,
      scope: m.scope,
      title_en: m.title_en,
      title_hi: m.title_hi,
      start_at: m.start_at.toISOString(),
      end_at: m.end_at.toISOString(),
      participation_points: m.participation_points,
      win_points: m.win_points,
      already_attempted,
      in_progress,
      is_winner,
      points_earned,
    };
  });
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

  const studentGeo = await geoForCentre(student.centre_id);
  if (!quizMatchesStudent(event, student, studentGeo.city_id, studentGeo.state_id)) {
    fail(res, 403, "ERR_FORBIDDEN", "This quiz is not available for this student.");
    return;
  }

  const now = new Date();
  if (now < event.start_at || now > event.end_at) {
    fail(res, 422, "ERR_WINDOW_CLOSED", "The quiz window is not open.");
    return;
  }

  const eventQuestions = await loadEventQuestionsForStudent(eventId);

  // Guarded insert — concurrent starts share one attempt row (no 23505 → 500).
  const inserted = await db
    .insert(quiz_attempts)
    .values({
      quiz_event_id: eventId,
      student_id: student.id,
      started_at: now,
      total_count: eventQuestions.length,
    })
    .onConflictDoNothing({
      target: [quiz_attempts.quiz_event_id, quiz_attempts.student_id],
    })
    .returning({ id: quiz_attempts.id });

  if (inserted.length === 0) {
    const [existing] = await db
      .select({
        id: quiz_attempts.id,
        submitted_at: quiz_attempts.submitted_at,
        answers: quiz_attempts.answers,
      })
      .from(quiz_attempts)
      .where(and(eq(quiz_attempts.quiz_event_id, eventId), eq(quiz_attempts.student_id, student.id)))
      .limit(1);
    if (!existing) {
      fail(res, 500, "ERR_INTERNAL", "Could not open or resume this quiz attempt.");
      return;
    }
    if (existing.submitted_at) {
      fail(res, 409, "ERR_ALREADY_SUBMITTED", "You have already submitted this quiz.");
      return;
    }
    ok(res, {
      attempt_id: existing.id,
      questions: eventQuestions,
      resumed: true,
      answers: existing.answers ?? {},
    });
    return;
  }

  ok(res, { attempt_id: inserted[0]!.id, questions: eventQuestions, resumed: false });
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

  // Resolve AT21 points outside the award transaction (avoid holding a pool
  // connection while reading punya_configs / Redis).
  const studentGeo = await geoForCentre(student.centre_id);
  const participationPoints = await resolveQuizParticipationPoints(
    studentGeo.city_id,
    event.participation_points,
  );
  const winPoints = await resolveQuizWinPoints(studentGeo.city_id, event.win_points);

  // Atomic submit: serialize on the attempt id, then conditionally claim the
  // attempt by setting submitted_at ONLY if it is still null. Points are awarded
  // exclusively on the winning transition, so two concurrent submits (or a
  // re-submit that slipped past the read-time guard above) can never
  // double-award. `db.transaction` keeps grade-claim-award on one connection, and
  // the award is composed into the SAME tx so a crash in the window can't strand
  // points with no retry path. The attempt-scoped idempotencyKey makes the award
  // exactly-once even if the whole request is retried after the claim commits.
  const result = await db.transaction(async (tx) => {
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
    if (rows.length === 0) return { claimed: false as const, pointsAwarded: 0 };

    // Award participation once; win bonus only when every question is correct.
    let pointsAwarded = 0;
    if (participationPoints > 0) {
      const rev = await nextQuizAwardRevision(tx, attempt.id, "participation");
      await awardPunya(
        {
          studentId: student.id,
          featureKey: QUIZ_PARTICIPATION_FEATURE_KEY,
          points: participationPoints,
          note: `Quiz participation: ${event.title_en}`,
          idempotencyKey: quizAwardIdempotencyKey(attempt.id, "participation", rev),
          sourceEntityKind: "quiz_attempt",
          sourceEntityId: attempt.id,
        },
        tx,
      );
      pointsAwarded += participationPoints;
    }
    if (allCorrect && winPoints > 0) {
      const rev = await nextQuizAwardRevision(tx, attempt.id, "win");
      await awardPunya(
        {
          studentId: student.id,
          featureKey: QUIZ_WIN_FEATURE_KEY,
          points: winPoints,
          note: `Quiz win: ${event.title_en}`,
          idempotencyKey: quizAwardIdempotencyKey(attempt.id, "win", rev),
          sourceEntityKind: "quiz_attempt",
          sourceEntityId: attempt.id,
        },
        tx,
      );
      pointsAwarded += winPoints;
    }
    return { claimed: true as const, pointsAwarded };
  });

  // Lost the race / already submitted by a concurrent request: do not re-award.
  if (!result.claimed) {
    fail(res, 409, "ERR_ALREADY_SUBMITTED", "This quiz was already submitted.");
    return;
  }

  const pointsAwarded = result.pointsAwarded;

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
    scope: z.enum(QUIZ_SCOPES).default("batch"),
    state_ids: z.array(z.string().uuid()).default([]),
    city_ids: z.array(z.string().uuid()).default([]),
    centre_ids: z.array(z.string().uuid()).default([]),
    batch_ids: z.array(z.string().uuid()).default([]),
    batch_id: z.string().uuid().optional(),
    expires_at: z.string().datetime(),
    // null/omit = punya_features default; 0 disables (AT21).
    completion_points: z.number().int().min(0).max(10000).nullish(),
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

/* GET /v1/quizzes/push — scoped list (live first) for admin panel */
router.get("/push", requireAdminPanel, async (req: Request, res: Response) => {
  const limit = clampLimit(req.query.limit, 100, 300);
  const rows = await db
    .select({
      id: push_quizzes.id,
      scope: push_quizzes.scope,
      state_ids: push_quizzes.state_ids,
      city_ids: push_quizzes.city_ids,
      centre_ids: push_quizzes.centre_ids,
      batch_ids: push_quizzes.batch_ids,
      batch_id: push_quizzes.batch_id,
      started_at: push_quizzes.started_at,
      expires_at: push_quizzes.expires_at,
      completion_points: push_quizzes.completion_points,
      question_count: sql<number>`count(distinct ${push_quiz_questions.id})::int`,
      submitted_count: sql<number>`count(distinct ${push_quiz_attempts.id}) filter (where ${push_quiz_attempts.submitted_at} is not null)::int`,
    })
    .from(push_quizzes)
    .leftJoin(push_quiz_questions, eq(push_quiz_questions.push_quiz_id, push_quizzes.id))
    .leftJoin(push_quiz_attempts, eq(push_quiz_attempts.push_quiz_id, push_quizzes.id))
    .groupBy(push_quizzes.id)
    .orderBy(sql`(case when ${push_quizzes.expires_at} > now() then 0 else 1 end)`, desc(push_quizzes.started_at))
    .limit(limit);

  const items = [];
  for (const r of rows) {
    if (!(await quizTargetsInAdminScope(req.authUser!, r))) continue;
    items.push({
      id: r.id,
      scope: r.scope,
      state_ids: r.state_ids,
      city_ids: r.city_ids,
      centre_ids: r.centre_ids,
      batch_ids: r.batch_ids,
      batch_id: r.batch_id,
      started_at: r.started_at.toISOString(),
      expires_at: r.expires_at.toISOString(),
      completion_points: r.completion_points,
      question_count: r.question_count,
      submitted_count: r.submitted_count,
      is_live: r.expires_at.getTime() > Date.now(),
    });
  }
  ok(res, { items }, { count: items.length });
});

/* POST /v1/quizzes/push — admin starts a live push quiz for selected targets */
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

  const auth = await authorizeQuizTargets(req.authUser!, body.scope, body);
  if (auth.error) {
    fail(res, 403, "ERR_FORBIDDEN", auth.error);
    return;
  }

  // batch_id column is optional; keep first batch for legacy readers when present.
  const primaryBatchId = auth.targets.batch_ids[0] ?? null;
  // For non-batch scopes, pick any in-scope batch as a placeholder FK if needed —
  // column is nullable now, so leave null for national/state/city/centre.

  const [pq] = await db
    .insert(push_quizzes)
    .values({
      scope: body.scope,
      state_ids: auth.targets.state_ids,
      city_ids: auth.targets.city_ids,
      centre_ids: auth.targets.centre_ids,
      batch_ids: auth.targets.batch_ids,
      batch_id: primaryBatchId,
      shikshak_user_id: req.authUser!.id,
      started_at: new Date(),
      expires_at: new Date(body.expires_at),
      completion_points: body.completion_points ?? undefined,
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
    summary: `Started push quiz (${body.scope})`,
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

  // Optional batch_id must match the student's enrolled batch when provided.
  if (parsed.data.batch_id && parsed.data.batch_id !== student.batch_id) {
    ok(res, { active: null });
    return;
  }

  const studentGeo = await geoForCentre(student.centre_id);
  const now = new Date();
  const [pq] = await db
    .select({
      id: push_quizzes.id,
      started_at: push_quizzes.started_at,
      expires_at: push_quizzes.expires_at,
      completion_points: push_quizzes.completion_points,
    })
    .from(push_quizzes)
    .where(
      and(
        gte(push_quizzes.expires_at, now),
        quizMatchesStudentSql(
          {
            scope: push_quizzes.scope,
            state_ids: push_quizzes.state_ids,
            city_ids: push_quizzes.city_ids,
            centre_ids: push_quizzes.centre_ids,
            batch_ids: push_quizzes.batch_ids,
            batch_id: push_quizzes.batch_id,
          },
          student,
          studentGeo.city_id,
          studentGeo.state_id,
        ),
      ),
    )
    .orderBy(desc(push_quizzes.started_at))
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

/* GET /v1/quizzes/push/:id/attempts — admin results roster (poll while live) */
router.get("/push/:id/attempts", requireAdminPanel, async (req: Request, res: Response) => {
  const pushId = String(req.params.id);
  const [pq] = await db.select().from(push_quizzes).where(eq(push_quizzes.id, pushId)).limit(1);
  if (!pq) {
    fail(res, 404, "ERR_NOT_FOUND", "Push quiz not found.");
    return;
  }
  if (!(await quizTargetsInAdminScope(req.authUser!, pq))) {
    fail(res, 403, "ERR_FORBIDDEN", "This push quiz is outside your scope.");
    return;
  }

  const qRows = await db
    .select({
      id: push_quiz_questions.id,
      correct_indices: push_quiz_questions.correct_indices,
      order_index: push_quiz_questions.order_index,
    })
    .from(push_quiz_questions)
    .where(eq(push_quiz_questions.push_quiz_id, pushId))
    .orderBy(asc(push_quiz_questions.order_index));

  const attemptRows = await db
    .select({
      id: push_quiz_attempts.id,
      student_id: push_quiz_attempts.student_id,
      full_name: students.full_name,
      centre_name: centres.name,
      batch_name: batches.name,
      submitted_at: push_quiz_attempts.submitted_at,
      score: push_quiz_attempts.score,
      answers: push_quiz_attempts.answers,
    })
    .from(push_quiz_attempts)
    .innerJoin(students, eq(students.id, push_quiz_attempts.student_id))
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .leftJoin(batches, eq(batches.id, students.batch_id))
    .where(eq(push_quiz_attempts.push_quiz_id, pushId))
    .orderBy(asc(students.full_name));

  const items = [];
  for (const row of attemptRows) {
    const answers = (row.answers ?? {}) as Record<string, number[]>;
    const question_results = qRows.map((q) => ({
      question_id: q.id,
      correct: sameIndexSet(answers[q.id] ?? [], q.correct_indices),
    }));
    const correct_count = question_results.filter((q) => q.correct).length;
    items.push({
      attempt_id: row.id,
      student_id: row.student_id,
      full_name: row.full_name,
      centre_name: row.centre_name,
      batch_name: row.batch_name,
      started_at: null as string | null,
      submitted_at: row.submitted_at ? row.submitted_at.toISOString() : null,
      correct_count,
      total_count: qRows.length,
      score: row.score,
      points_awarded: await pointsAwardedForAttempt(row.id),
      question_results,
    });
  }

  const submitted = items.filter((i) => i.submitted_at);
  const scoreSum = submitted.reduce((acc, i) => acc + (i.score ?? 0), 0);
  const average_score = submitted.length ? scoreSum / submitted.length : 0;
  const eligible_count = await countEligibleStudents(pq);
  const is_live = pq.expires_at.getTime() > Date.now();

  ok(
    res,
    {
      items,
      is_live,
      attempted_count: items.length,
      submitted_count: submitted.length,
      eligible_count,
      average_score,
    },
    { count: items.length },
  );
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
      scope: push_quizzes.scope,
      state_ids: push_quizzes.state_ids,
      city_ids: push_quizzes.city_ids,
      centre_ids: push_quizzes.centre_ids,
      batch_ids: push_quizzes.batch_ids,
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
  const studentGeo = await geoForCentre(student.centre_id);
  if (!quizMatchesStudent(pq, student, studentGeo.city_id, studentGeo.state_id)) {
    fail(res, 403, "ERR_FORBIDDEN", "This quiz is not available for this student.");
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

  // Resolve AT21 points outside the award transaction.
  const completionPoints = await resolvePushQuizCompletionPoints(
    studentGeo.city_id,
    pq.completion_points,
  );

  // Atomic submit: serialize on (push quiz, student), then upsert the attempt
  // but only let the update fire when the existing row has NOT been submitted
  // yet (setWhere: submitted_at IS NULL). `.returning()` yields a row ONLY on
  // the winning transition (fresh insert, or update of a not-yet-submitted row);
  // a conflict against an already-submitted row updates nothing and returns [].
  // Completion points are awarded exclusively on that winning transition, so two
  // concurrent submits can never double-award. The award is composed into the
  // SAME tx so a crash in the window can't strand points with no retry path; the
  // attempt-scoped idempotencyKey makes it exactly-once across full retries too.
  const result = await db.transaction(async (tx) => {
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
    if (rows.length === 0) return { claimed: false as const, pointsAwarded: 0 };

    // Reached only on the winning claim above, so completion points award once.
    let pointsAwarded = 0;
    if (completionPoints > 0) {
      await awardPunya(
        {
          studentId: student.id,
          featureKey: PUSH_QUIZ_COMPLETION_FEATURE_KEY,
          points: completionPoints,
          note: "Push quiz completion",
          idempotencyKey: `quiz-award:${rows[0]!.id}`,
          sourceEntityKind: "push_quiz_attempt",
          sourceEntityId: rows[0]!.id,
        },
        tx,
      );
      pointsAwarded = completionPoints;
    }
    return { claimed: true as const, pointsAwarded };
  });

  // Lost the race / already submitted by a concurrent request: do not re-award.
  if (!result.claimed) {
    fail(res, 409, "ERR_ALREADY_SUBMITTED", "You have already submitted this quiz.");
    return;
  }

  const pointsAwarded = result.pointsAwarded;

  ok(res, {
    push_quiz_id: pushId,
    score,
    correct_count: correctCount,
    total_count: qRows.length,
    points_awarded: pointsAwarded,
  });
});

export default router;
