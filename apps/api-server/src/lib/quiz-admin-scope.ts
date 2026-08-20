/**
 * Quiz ADMIN scope — who may read a quiz's results, and who may change it.
 *
 * These are two different questions and used to be answered by one function.
 * `quizTargetsInAdminScope` was written for "may this admin view results" and
 * then became the sole authorization check on PATCH/DELETE/reset/force-delete
 * as well. It answers the read question existentially — one centre inside a
 * targeted city is enough — and returned true unconditionally for national
 * scope. Reused as a write gate that meant: an admin could mutate objects far
 * outside their own scope, because the `allowedQuizScopes` role cap that blocks
 * them from CREATING those objects was never re-applied to MUTATING them.
 *
 * So:
 *   quizVisibleToAdmin  — existential. "Does this quiz reach a student I hold?"
 *                         Callers must ALSO narrow the rows they return with
 *                         adminStudentScopeCondition, or a sanchalak reads
 *                         every attempting child in the city.
 *   quizWritableByAdmin — containment. "Is every target inside my scope, and
 *                         is this a scope my role may author at all?"
 *
 * Student-side matching (does this quiz apply to THIS child) lives in
 * quiz-scope.ts and is a separate rule — do not merge the two.
 */
import { db, batches, centres, cities, students, type User } from "@workspace/db";
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { resolveAdminScope, type AdminScope } from "./scope";

export const QUIZ_SCOPES = ["national", "state", "city", "centre", "batch"] as const;
export type QuizScope = (typeof QUIZ_SCOPES)[number];

export type QuizTargetRow = {
  scope: string;
  state_ids?: string[] | null;
  city_ids?: string[] | null;
  centre_ids?: string[] | null;
  batch_ids?: string[] | null;
  city_id?: string | null;
  centre_id?: string | null;
  batch_id?: string | null;
};

/** Scopes a role may AUTHOR. Also the cap re-applied on every mutation. */
export function allowedQuizScopes(role: string): QuizScope[] {
  if (role === "super_admin") return [...QUIZ_SCOPES];
  if (role === "state_admin") return ["state", "city", "centre", "batch"];
  if (role === "city_admin") return ["city", "centre", "batch"];
  return ["centre", "batch"];
}

/* ---- city scope: null = all (super_admin); [] = nothing; else city ids ---- */
export async function cityScopeForUser(user: User): Promise<string[] | null> {
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

export function cityInScope(cityIds: string[] | null, cityId: string | null): boolean {
  if (cityIds === null) return true;
  if (!cityId) return false;
  return cityIds.includes(cityId);
}

/** Array targets with the legacy single FKs folded in. */
export function normalizeQuizTargets(targets: QuizTargetRow): {
  stateIds: string[];
  cityIds: string[];
  centreIds: string[];
  batchIds: string[];
} {
  return {
    stateIds: targets.state_ids?.length ? targets.state_ids : [],
    cityIds: targets.city_ids?.length ? targets.city_ids : targets.city_id ? [targets.city_id] : [],
    centreIds: targets.centre_ids?.length
      ? targets.centre_ids
      : targets.centre_id
        ? [targets.centre_id]
        : [],
    batchIds: targets.batch_ids?.length ? targets.batch_ids : targets.batch_id ? [targets.batch_id] : [],
  };
}

/**
 * Centres the caller effectively holds.
 *
 * For a batch-restricted role (shikshak) this is NOT `scope.centreIds`: they
 * are tagged to a centre for reading but assigned to specific batches. A
 * shikshak tagged to a centre where they teach no batch must not pass the
 * centre branch — Q12 solved the same problem for niyams with
 * `inBatchWriteScope`, and quizzes had no equivalent.
 *
 * null = unrestricted (super_admin).
 */
async function effectiveCentreIds(scope: AdminScope): Promise<string[] | null> {
  if (scope.centreIds === null) return null;
  if (scope.batchIds === null) return scope.centreIds;
  if (scope.batchIds.length === 0) return [];
  const rows = await db
    .select({ centre_id: batches.centre_id })
    .from(batches)
    .where(inArray(batches.id, scope.batchIds));
  const fromBatches = new Set(rows.map((r) => r.centre_id));
  return scope.centreIds.filter((id) => fromBatches.has(id));
}

/**
 * READ gate — may this admin open this quiz's results at all?
 *
 * Deliberately existential: a sanchalak whose centre took part in a city-wide
 * quiz has a legitimate reason to open it. The containment happens on the ROWS
 * (adminStudentScopeCondition), not on the request.
 */
export async function quizVisibleToAdmin(user: User, targets: QuizTargetRow): Promise<boolean> {
  const scope = await resolveAdminScope(user);
  if (scope.centreIds === null) return true;

  const effective = await effectiveCentreIds(scope);
  if (effective === null) return true;
  if (effective.length === 0) return false;

  const t = normalizeQuizTargets(targets);

  switch (targets.scope) {
    case "national":
      // Not an unconditional true any more: it is true because the caller holds
      // students, who are by definition inside a national quiz. A caller who
      // holds nothing was already refused by the effective-centres check above.
      return true;
    case "state": {
      if (t.stateIds.length === 0) return false;
      const rows = await db
        .select({ id: centres.id })
        .from(centres)
        .where(
          and(
            inArray(centres.state_id, t.stateIds),
            inArray(centres.id, effective),
            isNull(centres.deleted_at),
          ),
        )
        .limit(1);
      return rows.length > 0;
    }
    case "city": {
      if (t.cityIds.length === 0) return false;
      const rows = await db
        .select({ id: centres.id })
        .from(centres)
        .where(
          and(
            inArray(centres.city_id, t.cityIds),
            inArray(centres.id, effective),
            isNull(centres.deleted_at),
          ),
        )
        .limit(1);
      return rows.length > 0;
    }
    case "centre":
      return t.centreIds.some((id) => effective.includes(id));
    case "batch": {
      if (t.batchIds.length === 0) return false;
      if (scope.batchIds !== null) return t.batchIds.some((id) => scope.batchIds!.includes(id));
      const rows = await db
        .select({ centre_id: batches.centre_id })
        .from(batches)
        .where(inArray(batches.id, t.batchIds));
      return rows.some((b) => effective.includes(b.centre_id));
    }
    default:
      return false;
  }
}

/**
 * WRITE gate — may this admin edit, reset or delete this quiz object?
 *
 * Containment, not existence: holding ONE centre in a targeted city does not
 * entitle you to rewrite a quiz aimed at the whole city. And the authoring cap
 * is re-applied, so a role cannot mutate what it could never have created.
 */
export async function quizWritableByAdmin(user: User, targets: QuizTargetRow): Promise<boolean> {
  const scope = await resolveAdminScope(user);
  // super_admin first, so legacy rows with an unrecognised scope stay fixable.
  if (scope.centreIds === null) return true;

  const quizScope = targets.scope as QuizScope;
  if (!allowedQuizScopes(user.role).includes(quizScope)) return false;

  const t = normalizeQuizTargets(targets);

  switch (quizScope) {
    case "national":
      // Unreachable: the cap above already denies every non-super role.
      return false;
    case "state": {
      if (t.stateIds.length === 0) return false;
      if (user.role !== "state_admin" || !user.state_id) return false;
      return t.stateIds.every((id) => id === user.state_id);
    }
    case "city": {
      if (t.cityIds.length === 0) return false;
      const cityIds = await cityScopeForUser(user);
      return t.cityIds.every((id) => cityInScope(cityIds, id));
    }
    case "centre": {
      if (t.centreIds.length === 0) return false;
      const effective = await effectiveCentreIds(scope);
      if (effective === null) return true;
      return t.centreIds.every((id) => effective.includes(id));
    }
    case "batch": {
      if (t.batchIds.length === 0) return false;
      if (scope.batchIds !== null) return t.batchIds.every((id) => scope.batchIds!.includes(id));
      const rows = await db
        .select({ id: batches.id, centre_id: batches.centre_id })
        .from(batches)
        .where(inArray(batches.id, t.batchIds));
      if (rows.length !== new Set(t.batchIds).size) return false;
      return rows.every((b) => scope.centreIds!.includes(b.centre_id));
    }
    default:
      return false;
  }
}

/**
 * Row-level narrowing for attempt rosters, keyed on `students`.
 *
 * The read gate above is existential on purpose, so it MUST be paired with
 * this: without it, opening a city-wide event returns every attempting
 * student's name, centre, batch, score and per-question answers across every
 * centre in that city. Apply it to the roster query, to countEligibleStudents
 * and to the average, or the header contradicts the table.
 *
 * `undefined` = no restriction (super_admin).
 */
export async function adminStudentScopeCondition(user: User): Promise<SQL | undefined> {
  const scope = await resolveAdminScope(user);
  if (scope.centreIds === null) return undefined;
  if (scope.centreIds.length === 0) return sql`false`;
  // Batch-restricted roles narrow to their batches, not their tagged centres.
  if (scope.batchIds !== null) {
    if (scope.batchIds.length === 0) return sql`false`;
    return inArray(students.batch_id, scope.batchIds);
  }
  return inArray(students.centre_id, scope.centreIds);
}
