/**
 * H10 — exam top-score Punya had no reversal path.
 *
 * The job was award-only and keyed per (exam, student), which stops a DOUBLE
 * award to the same student but does nothing when a re-grade changes WHO the
 * top scorer is: the previous topper keeps their bonus, the new one gets their
 * own, and the exam pays two top scorers permanently. No client or admin
 * surface could undo it.
 *
 * Exam completion beside it already did AT18 reverse-then-award correctly.
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool, db, online_exams, exam_attempts } from "@workspace/db";
import { withLedgerMaintenance } from "./helpers";
import { eq } from "drizzle-orm";
import { runExamTopScoreAwards } from "../src/lib/exam-punya";

/** Planted fixtures, torn down in afterAll so they cannot fill the batch. */
const plantedStudentIds: string[] = [];

/**
 * The ledger is append-only at the database (0090) and students cascade into
 * it, so teardown declares itself. Without this these fixtures accumulate
 * across runs and push the shared batch past capacity, failing unrelated
 * tests (enrolments' auto-approve begins returning 409).
 */
async function removePlantedStudents(): Promise<void> {
  if (plantedStudentIds.length === 0) return;
  await withLedgerMaintenance(async (c) => {
    await c.query(`delete from student_course_progress where student_id = any($1::uuid[])`, [
      plantedStudentIds,
    ]);
    await c.query(`delete from course_certificates where student_id = any($1::uuid[])`, [
      plantedStudentIds,
    ]);
    // L15 / Q11 — punya_transactions.student_id is RESTRICT, not CASCADE.
    await c.query(`delete from punya_transactions where student_id = any($1::uuid[])`, [
      plantedStudentIds,
    ]);
    await c.query(`delete from students where id = any($1::uuid[])`, [plantedStudentIds]);
  });
}
afterAll(async () => {
  await removePlantedStudents();
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

async function plantStudent(tag: string): Promise<string> {
  const pick = await pool.query<{ batch_id: string; centre_id: string }>(
    `select b.id as batch_id, b.centre_id from batches b
      where b.deleted_at is null and b.status = 'active' limit 1`,
  );
  const { batch_id, centre_id } = pick.rows[0]!;
  const { rows } = await pool.query<{ id: string }>(
    `insert into students (centre_id, batch_id, full_name, student_code, status, dob, gender, age_group)
     values ($1, $2, $3, $4, 'active', '2014-01-01', 'male', 'kishor')
     returning id`,
    [centre_id, batch_id, `TopScore ${tag}`, `TS${tag}`.slice(0, 24)],
  );
  plantedStudentIds.push(rows[0]!.id);
  return rows[0]!.id;
}

async function liveAwards(examId: string): Promise<Array<{ student_id: string; points: number }>> {
  const { rows } = await pool.query<{ student_id: string; points: number }>(
    `select t.student_id, t.points
       from punya_transactions t
      where t.source_entity_kind = 'exam_top_score'
        and t.source_entity_id = $1
        and t.points > 0
        and not exists (select 1 from punya_transactions r where r.reversal_of = t.id)
      order by t.created_at`,
    [examId],
  );
  return rows.map((r) => ({ ...r, points: Number(r.points) }));
}

async function netTopScore(studentId: string): Promise<number> {
  const { rows } = await pool.query<{ total: string }>(
    `select coalesce(sum(points), 0)::text as total from punya_transactions
      where student_id = $1 and source_entity_kind = 'exam_top_score'`,
    [studentId],
  );
  return Number(rows[0]!.total);
}

describe("H10 — exam top score re-settles after a re-grade", () => {
  it("a re-grade moves the bonus instead of paying two toppers", async () => {
    const tag = `${Date.now().toString(36).slice(-6)}`;
    const cityRow = await pool.query<{ id: string }>(`select id from cities limit 1`);
    const [exam] = await db
      .insert(online_exams)
      .values({
        title_en: `H10 Exam ${tag}`,
        title_hi: `H10 परीक्षा ${tag}`,
        city_id: cityRow.rows[0]!.id,
        window_start: new Date(Date.now() - 86_400_000),
        window_end: new Date(Date.now() - 3_600_000),
        total_marks: 100,
        pass_mark: 40,
        max_attempts: 1,
        top_score_points: 50,
        results_released: true,
      })
      .returning({ id: online_exams.id });
    const examId = exam!.id;

    const alice = await plantStudent(`${tag}a`);
    const bob = await plantStudent(`${tag}b`);

    const mkAttempt = async (studentId: string, score: number) => {
      const [row] = await db
        .insert(exam_attempts)
        .values({
          exam_id: examId,
          student_id: studentId,
          status: "graded", started_at: new Date(),
          score,
          attempt_number: 1,
        })
        .returning({ id: exam_attempts.id });
      return row!.id;
    };

    await mkAttempt(alice, 90);
    const bobAttempt = await mkAttempt(bob, 70);

    // First run: Alice is the sole topper.
    const first = await runExamTopScoreAwards(examId);
    expect(first.awarded).toBe(1);
    expect(await liveAwards(examId)).toEqual([{ student_id: alice, points: 50 }]);

    // Re-grade: Bob's paper is remarked to 95 and now tops the exam.
    await db.update(exam_attempts).set({ score: 95 }).where(eq(exam_attempts.id, bobAttempt));

    const second = await runExamTopScoreAwards(examId);
    expect(second.awarded).toBe(1);
    expect(second.reversed).toBe(1);

    // Exactly ONE live award, and it belongs to Bob.
    expect(await liveAwards(examId)).toEqual([{ student_id: bob, points: 50 }]);
    // Alice's bonus is clawed back to zero net, not left standing.
    expect(await netTopScore(alice)).toBe(0);
    expect(await netTopScore(bob)).toBe(50);

    // Idempotent: a third run with no change moves nothing.
    const third = await runExamTopScoreAwards(examId);
    expect(third).toEqual({ awarded: 0, reversed: 0 });
    expect(await netTopScore(alice)).toBe(0);
    expect(await netTopScore(bob)).toBe(50);
  });

  it("a student who tops, loses it, then tops again is paid again", async () => {
    const tag = `${Date.now().toString(36).slice(-6)}r`;
    const cityRow = await pool.query<{ id: string }>(`select id from cities limit 1`);
    const [exam] = await db
      .insert(online_exams)
      .values({
        title_en: `H10 Regen ${tag}`,
        title_hi: `H10 पुनः ${tag}`,
        city_id: cityRow.rows[0]!.id,
        window_start: new Date(Date.now() - 86_400_000),
        window_end: new Date(Date.now() - 3_600_000),
        total_marks: 100,
        pass_mark: 40,
        max_attempts: 1,
        top_score_points: 50,
        results_released: true,
      })
      .returning({ id: online_exams.id });
    const examId = exam!.id;

    const alice = await plantStudent(`${tag}a`);
    const bob = await plantStudent(`${tag}b`);
    const [aliceAttempt] = await db
      .insert(exam_attempts)
      .values({ exam_id: examId, student_id: alice, status: "graded", started_at: new Date(), score: 90, attempt_number: 1 })
      .returning({ id: exam_attempts.id });
    await db
      .insert(exam_attempts)
      .values({ exam_id: examId, student_id: bob, status: "graded", started_at: new Date(), score: 70, attempt_number: 1 });

    await runExamTopScoreAwards(examId);
    expect(await netTopScore(alice)).toBe(50);

    // Alice's mark is corrected down — Bob tops, Alice is reversed.
    await db.update(exam_attempts).set({ score: 60 }).where(eq(exam_attempts.id, aliceAttempt!.id));
    await runExamTopScoreAwards(examId);
    expect(await netTopScore(alice)).toBe(0);
    expect(await netTopScore(bob)).toBe(50);

    // The correction is itself corrected — Alice tops again. Without the
    // generation suffix her base key is already in the ledger and ON CONFLICT
    // DO NOTHING would silently skip this, leaving her permanently unpaid.
    await db.update(exam_attempts).set({ score: 99 }).where(eq(exam_attempts.id, aliceAttempt!.id));
    await runExamTopScoreAwards(examId);
    expect(await netTopScore(alice)).toBe(50);
    expect(await netTopScore(bob)).toBe(0);
  });
});
