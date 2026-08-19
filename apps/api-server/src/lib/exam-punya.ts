/**
 * Exam Punya awards (SPEC §5.14, AT18/AT20/AT21).
 *
 * Completion awards fire when an attempt reaches status='graded' and the score
 * meets pass_mark. Top-score awards run after results_released via a separate
 * job so a re-grade cannot double-award that bonus.
 */
import { db, online_exams, exam_attempts } from "@workspace/db";
import { and, eq, gte, or, sql } from "drizzle-orm";
import { awardPunya, reversePunya } from "./punya";
import {
  EXAM_COMPLETION_FEATURE_KEY,
  EXAM_TOP_SCORE_FEATURE_KEY,
  resolveExamTopScorePoints,
} from "./exam-points";
import { logger } from "./logger";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Canonical base key — generation suffix appended after a reversal (AT18). */
export function examCompletionKey(
  examId: string,
  studentId: string,
  attemptId: string,
  generation = 0,
): string {
  const base = `exam:${examId}:${studentId}:${attemptId}:completion`;
  return generation <= 0 ? base : `${base}:g${generation}`;
}

export function examTopScoreKey(
  examId: string,
  studentId: string,
  generation = 0,
): string {
  const base = `exam:${examId}:${studentId}:top_score`;
  return generation <= 0 ? base : `${base}:g${generation}`;
}

function generationFromKey(key: string): number {
  const m = /:completion(?::g(\d+))?$/.exec(key);
  if (!m) return 0;
  return m[1] ? Number(m[1]) : 0;
}

function examCompletionReversalKey(awardKey: string): string {
  return `${awardKey}:reversal`;
}

async function findLatestUnreversedCompletionAward(
  tx: Tx | typeof db,
  attemptId: string,
  studentId: string,
): Promise<{ id: string; points: number; idempotency_key: string } | null> {
  const result = await tx.execute(sql`
    select t.id, t.points, t.idempotency_key
    from punya_transactions t
    where t.student_id = ${studentId}::uuid
      and t.source_entity_kind = ${EXAM_COMPLETION_FEATURE_KEY}
      and t.source_entity_id = ${attemptId}::uuid
      and t.points > 0
      and t.idempotency_key is not null
      and not exists (
        select 1 from punya_transactions r
        where r.reversal_of = t.id
      )
    order by t.created_at desc
    limit 1
  `);
  const rows =
    (
      result as unknown as {
        rows?: Array<{ id: string; points: number; idempotency_key: string }>;
      }
    ).rows ?? [];
  const row = rows[0];
  if (!row?.idempotency_key) return null;
  return { id: row.id, points: Number(row.points), idempotency_key: row.idempotency_key };
}

export type AwardExamCompletionInput = {
  examId: string;
  studentId: string;
  attemptId: string;
  /** Final total score for the attempt. */
  score: number;
  passMark: number;
  /** Resolved points (caller resolves BEFORE opening the transaction — avoid pool deadlock). */
  points: number;
  awardedBy?: string | null;
};

/**
 * Synchronize completion Punya with award-worthiness (pass).
 * AT18: reverse-then-award when worthiness or value changes; never a bare second award.
 * AT20: awardPunya uses ON CONFLICT DO NOTHING … RETURNING then credits only what returned.
 */
export async function awardExamCompletionPunya(
  input: AwardExamCompletionInput,
  tx?: Tx,
): Promise<{ awarded: boolean; reversed: boolean; points: number }> {
  const run = async (client: Tx | typeof db) => {
    const worthAwarding = input.score >= input.passMark && input.points > 0;
    const prior = await findLatestUnreversedCompletionAward(
      client,
      input.attemptId,
      input.studentId,
    );

    if (!worthAwarding) {
      if (!prior) return { awarded: false, reversed: false, points: 0 };
      await reversePunya(
        {
          studentId: input.studentId,
          featureKey: EXAM_COMPLETION_FEATURE_KEY,
          points: prior.points,
          note: "Exam completion reversed (score below pass mark).",
          awardedBy: input.awardedBy ?? null,
          idempotencyKey: examCompletionReversalKey(prior.idempotency_key),
        },
        client as Tx,
      );
      return { awarded: false, reversed: true, points: prior.points };
    }

    if (prior && prior.points === input.points) {
      return { awarded: false, reversed: false, points: prior.points };
    }

    if (prior && prior.points !== input.points) {
      await reversePunya(
        {
          studentId: input.studentId,
          featureKey: EXAM_COMPLETION_FEATURE_KEY,
          points: prior.points,
          note: "Exam completion reversed before re-award.",
          awardedBy: input.awardedBy ?? null,
          idempotencyKey: examCompletionReversalKey(prior.idempotency_key),
        },
        client as Tx,
      );
    }

    const generation = prior ? generationFromKey(prior.idempotency_key) + 1 : 0;
    const key = examCompletionKey(input.examId, input.studentId, input.attemptId, generation);
    const award = await awardPunya(
      {
        studentId: input.studentId,
        featureKey: EXAM_COMPLETION_FEATURE_KEY,
        points: input.points,
        note: "Exam completion (passed).",
        awardedBy: input.awardedBy ?? null,
        idempotencyKey: key,
        sourceEntityKind: EXAM_COMPLETION_FEATURE_KEY,
        sourceEntityId: input.attemptId,
        sourceRevision: generation,
      },
      client as Tx,
    );
    return { awarded: award.awarded, reversed: !!prior, points: input.points };
  };

  if (tx) return run(tx);
  return db.transaction((t) => run(t));
}

/**
 * Award top-score Punya for one exam (or a recent released-exam sweep when examId omitted).
 * Keyed per (exam, student) so re-grades cannot double-award.
 *
 * Cron path (no examId): only exams with window_end or updated_at in the last 30 days —
 * release-results is the primary trigger and passes exam_id explicitly.
 */
/** Unreversed top-score awards standing against one exam. */
async function findLiveTopScoreAwards(
  examId: string,
): Promise<Array<{ student_id: string; points: number; idempotency_key: string }>> {
  const result = await db.execute(sql`
    select t.student_id, t.points, t.idempotency_key
    from punya_transactions t
    where t.source_entity_kind = ${EXAM_TOP_SCORE_FEATURE_KEY}
      and t.source_entity_id = ${examId}::uuid
      and t.points > 0
      and t.idempotency_key is not null
      and not exists (
        select 1 from punya_transactions r where r.reversal_of = t.id
      )
  `);
  const rows =
    (result as unknown as {
      rows?: Array<{ student_id: string; points: number; idempotency_key: string }>;
    }).rows ?? [];
  return rows.map((r) => ({ ...r, points: Number(r.points) }));
}

/** How many top-score awards this student has ever held for this exam. */
async function countTopScoreAwards(examId: string, studentId: string): Promise<number> {
  const result = await db.execute(sql`
    select count(*)::int as n
    from punya_transactions t
    where t.student_id = ${studentId}::uuid
      and t.source_entity_kind = ${EXAM_TOP_SCORE_FEATURE_KEY}
      and t.source_entity_id = ${examId}::uuid
      and t.points > 0
  `);
  return Number((result as unknown as { rows?: Array<{ n: number }> }).rows?.[0]?.n ?? 0);
}

export async function runExamTopScoreAwards(
  examId?: string,
): Promise<{ awarded: number; reversed: number }> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const exams = await db
    .select({
      id: online_exams.id,
      city_id: online_exams.city_id,
      top_score_points: online_exams.top_score_points,
      title_en: online_exams.title_en,
    })
    .from(online_exams)
    .where(
      and(
        eq(online_exams.results_released, true),
        examId
          ? eq(online_exams.id, examId)
          : or(gte(online_exams.window_end, since), gte(online_exams.updated_at, since)),
      ),
    );

  let awarded = 0;
  let reversed = 0;
  for (const exam of exams) {
    const points = await resolveExamTopScorePoints(exam.city_id, exam.top_score_points);
    if (points <= 0) continue;

    const [top] = await db
      .select({ max_score: sql<number>`max(${exam_attempts.score})::int` })
      .from(exam_attempts)
      .where(
        and(
          eq(exam_attempts.exam_id, exam.id),
          eq(exam_attempts.status, "graded"),
          sql`${exam_attempts.score} is not null`,
        ),
      );
    const maxScore = top?.max_score;
    if (maxScore == null) continue;

    const toppers = await db
      .select({ student_id: exam_attempts.student_id })
      .from(exam_attempts)
      .where(
        and(
          eq(exam_attempts.exam_id, exam.id),
          eq(exam_attempts.status, "graded"),
          eq(exam_attempts.score, maxScore),
        ),
      );

    // Distinct students (multiple attempts at the same top score).
    const seen = new Set<string>();
    for (const row of toppers) seen.add(row.student_id);

    // H10 — synchronize, do not merely add.
    //
    // This was award-only. A re-grade that raised another student above the
    // previous topper left the old award standing and added a new one, so the
    // exam paid two top scorers, permanently, with no path to correct it from
    // any surface. Exam COMPLETION already got this right (AT18
    // reverse-then-award); the bonus beside it did not.
    const live = await findLiveTopScoreAwards(exam.id);
    for (const prior of live) {
      if (seen.has(prior.student_id)) continue;
      await reversePunya({
        studentId: prior.student_id,
        featureKey: EXAM_TOP_SCORE_FEATURE_KEY,
        points: prior.points,
        note: `Exam top score reversed after re-grade: ${exam.title_en}`,
        idempotencyKey: `${prior.idempotency_key}:reversal`,
      });
      reversed += 1;
    }
    const liveByStudent = new Map(live.map((p) => [p.student_id, p]));

    for (const studentId of seen) {
      // Already holds an unreversed award for this exam — nothing to do.
      if (liveByStudent.has(studentId)) continue;
      // Generation-suffixed so a student who tops, loses it to a re-grade, and
      // tops again is awarded a second time instead of being silently skipped
      // by ON CONFLICT DO NOTHING on the base key.
      const generation = await countTopScoreAwards(exam.id, studentId);
      const result = await awardPunya({
        studentId,
        featureKey: EXAM_TOP_SCORE_FEATURE_KEY,
        points,
        note: `Exam top score: ${exam.title_en}`,
        idempotencyKey: examTopScoreKey(exam.id, studentId, generation),
        sourceEntityKind: EXAM_TOP_SCORE_FEATURE_KEY,
        sourceEntityId: exam.id,
      });
      if (result.awarded) awarded += 1;
    }
  }

  logger.info(
    { examId: examId ?? null, awarded, reversed },
    "exam.top_score awards processed",
  );
  return { awarded, reversed };
}
