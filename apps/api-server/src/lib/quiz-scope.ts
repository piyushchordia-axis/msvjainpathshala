/**
 * Quiz scope matching — JS authority (start/submit) and equivalent SQL predicate
 * for student list routes (events/available, push/active).
 */
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export type QuizScopeTargets = {
  scope: string;
  state_ids?: string[] | null;
  city_ids?: string[] | null;
  centre_ids?: string[] | null;
  batch_ids?: string[] | null;
  city_id?: string | null;
  centre_id?: string | null;
  batch_id?: string | null;
  age_groups?: string[] | null;
};

/**
 * Does this scheduled/push quiz apply to the given student?
 * Scope drives which target array is checked; legacy single FKs are used as fallback.
 */
export function quizMatchesStudent(
  ev: QuizScopeTargets,
  student: { centre_id: string | null; batch_id: string | null; age_group: string | null },
  studentCityId: string | null,
  studentStateId: string | null,
): boolean {
  if (
    ev.age_groups &&
    ev.age_groups.length > 0 &&
    !(student.age_group && ev.age_groups.includes(student.age_group))
  ) {
    return false;
  }
  const stateIds = ev.state_ids?.length ? ev.state_ids : [];
  const cityIds = ev.city_ids?.length ? ev.city_ids : ev.city_id ? [ev.city_id] : [];
  const centreIds = ev.centre_ids?.length ? ev.centre_ids : ev.centre_id ? [ev.centre_id] : [];
  const batchIds = ev.batch_ids?.length ? ev.batch_ids : ev.batch_id ? [ev.batch_id] : [];

  switch (ev.scope) {
    case "batch":
      return !!student.batch_id && batchIds.includes(student.batch_id);
    case "centre":
      return !!student.centre_id && centreIds.includes(student.centre_id);
    case "city":
      return !!studentCityId && cityIds.includes(studentCityId);
    case "state":
      return !!studentStateId && stateIds.includes(studentStateId);
    case "national":
      return true;
    default: {
      // Legacy rows with no scope discipline: narrow by most specific FK present.
      if (batchIds.length) return !!student.batch_id && batchIds.includes(student.batch_id);
      if (centreIds.length) return !!student.centre_id && centreIds.includes(student.centre_id);
      if (cityIds.length) return !!studentCityId && cityIds.includes(studentCityId);
      return true;
    }
  }
}

type ScopeCols = {
  scope: PgColumn;
  state_ids: PgColumn;
  city_ids: PgColumn;
  centre_ids: PgColumn;
  batch_ids: PgColumn;
  /** Legacy single FK — omit for tables that only have array targets. */
  city_id?: PgColumn;
  centre_id?: PgColumn;
  batch_id?: PgColumn;
  /** Only quiz_events carries age_groups. */
  age_groups?: PgColumn;
};

function uuidParam(id: string | null): SQL {
  return id ? sql`${id}::uuid` : sql`NULL::uuid`;
}

function textParam(v: string | null): SQL {
  return v != null ? sql`${v}::text` : sql`NULL::text`;
}

/**
 * SQL equivalent of quizMatchesStudent for filtering quiz_events / push_quizzes.
 * Must stay behaviourally identical to the JS helper (including legacy single FKs).
 */
export function quizMatchesStudentSql(
  cols: ScopeCols,
  student: { centre_id: string | null; batch_id: string | null; age_group: string | null },
  studentCityId: string | null,
  studentStateId: string | null,
): SQL {
  const centreId = uuidParam(student.centre_id);
  const batchId = uuidParam(student.batch_id);
  const cityId = uuidParam(studentCityId);
  const stateId = uuidParam(studentStateId);
  const ageGroup = textParam(student.age_group);

  const cityMatch = cols.city_id
    ? sql`(
        (cardinality(${cols.city_ids}) > 0 AND ${cityId} = ANY(${cols.city_ids}))
        OR (cardinality(${cols.city_ids}) = 0 AND ${cols.city_id} IS NOT NULL AND ${cols.city_id} = ${cityId})
      )`
    : sql`(cardinality(${cols.city_ids}) > 0 AND ${cityId} = ANY(${cols.city_ids}))`;

  const centreMatch = cols.centre_id
    ? sql`(
        (cardinality(${cols.centre_ids}) > 0 AND ${centreId} = ANY(${cols.centre_ids}))
        OR (cardinality(${cols.centre_ids}) = 0 AND ${cols.centre_id} IS NOT NULL AND ${cols.centre_id} = ${centreId})
      )`
    : sql`(cardinality(${cols.centre_ids}) > 0 AND ${centreId} = ANY(${cols.centre_ids}))`;

  const batchMatch = cols.batch_id
    ? sql`(
        (cardinality(${cols.batch_ids}) > 0 AND ${batchId} = ANY(${cols.batch_ids}))
        OR (cardinality(${cols.batch_ids}) = 0 AND ${cols.batch_id} IS NOT NULL AND ${cols.batch_id} = ${batchId})
      )`
    : sql`(cardinality(${cols.batch_ids}) > 0 AND ${batchId} = ANY(${cols.batch_ids}))`;

  const hasBatchTargets = cols.batch_id
    ? sql`(cardinality(${cols.batch_ids}) > 0 OR ${cols.batch_id} IS NOT NULL)`
    : sql`(cardinality(${cols.batch_ids}) > 0)`;
  const hasCentreTargets = cols.centre_id
    ? sql`(cardinality(${cols.centre_ids}) > 0 OR ${cols.centre_id} IS NOT NULL)`
    : sql`(cardinality(${cols.centre_ids}) > 0)`;
  const hasCityTargets = cols.city_id
    ? sql`(cardinality(${cols.city_ids}) > 0 OR ${cols.city_id} IS NOT NULL)`
    : sql`(cardinality(${cols.city_ids}) > 0)`;

  // Legacy default: most-specific FK present wins (mirrors JS if/else chain).
  const legacyMatch = sql`(
    CASE
      WHEN ${hasBatchTargets} THEN (${batchId} IS NOT NULL AND ${batchMatch})
      WHEN ${hasCentreTargets} THEN (${centreId} IS NOT NULL AND ${centreMatch})
      WHEN ${hasCityTargets} THEN (${cityId} IS NOT NULL AND ${cityMatch})
      ELSE true
    END
  )`;

  const scopeMatch = sql`(
    ${cols.scope} = 'national'
    OR (${cols.scope} = 'state' AND ${stateId} IS NOT NULL AND ${stateId} = ANY(${cols.state_ids}))
    OR (${cols.scope} = 'city' AND ${cityId} IS NOT NULL AND ${cityMatch})
    OR (${cols.scope} = 'centre' AND ${centreId} IS NOT NULL AND ${centreMatch})
    OR (${cols.scope} = 'batch' AND ${batchId} IS NOT NULL AND ${batchMatch})
    OR (
      ${cols.scope} NOT IN ('national', 'state', 'city', 'centre', 'batch')
      AND ${legacyMatch}
    )
  )`;

  if (!cols.age_groups) return scopeMatch;

  const ageMatch = sql`(
    cardinality(${cols.age_groups}) = 0
    OR (${ageGroup} IS NOT NULL AND ${ageGroup} = ANY(${cols.age_groups}::text[]))
  )`;
  return sql`(${scopeMatch} AND ${ageMatch})`;
}
