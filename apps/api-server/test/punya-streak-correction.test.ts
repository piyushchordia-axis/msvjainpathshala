/**
 * H9 — a retroactive attendance correction must leave the streak ledger at
 * exactly what the corrected history earns.
 *
 * The reversal was session-scoped: correcting session S2 called
 * reverseStreakBonusForSession for S2, which never held a bonus (milestones
 * landed on S4 and S8), so nothing reversed. The recompute then counted six
 * attended from S3, hit a milestone at S6, and awarded a NEW bonus. The student
 * held 60 where 20 was due — a bare second award with no matching reversal,
 * which is exactly what AT18 forbids — and it repeated on every correction.
 *
 * H8 rides along: the bonus is now resolved from punya_configs, so this file
 * also proves an admin edit of that row actually changes what is awarded.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool, db, sessions, attendance } from "@workspace/db";
import { withLedgerMaintenance } from "./helpers";
import { eq, and } from "drizzle-orm";
import { recomputeAndAwardStreak } from "../src/services/attendance-post-process";
import { reverseStreakBonusesFrom } from "../src/lib/punya-streak";
import { clearAttendancePointsCache } from "../src/lib/attendance-points";

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
    await c.query(`delete from students where id = any($1::uuid[])`, [plantedStudentIds]);
  });
}
afterAll(async () => {
  await removePlantedStudents();
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

beforeEach(() => {
  clearAttendancePointsCache();
});

const SESSION_COUNT = 8;

async function plantScenario(tag: string): Promise<{
  studentId: string;
  sessionIds: string[];
}> {
  const batchPick = await pool.query<{ batch_id: string; centre_id: string }>(
    `select b.id as batch_id, b.centre_id
       from batches b
      where b.deleted_at is null and b.status = 'active'
      limit 1`,
  );
  const { batch_id: batchId, centre_id: centreId } = batchPick.rows[0]!;

  const stu = await pool.query<{ id: string }>(
    `insert into students (centre_id, batch_id, full_name, student_code, status, dob, gender, age_group)
     values ($1, $2, $3, $4, 'active', '2015-01-01', 'male', 'bal')
     returning id`,
    [centreId, batchId, `H9 Streak ${tag}`, `H9${tag}`.slice(0, 24)],
  );
  const studentId = stu.rows[0]!.id;

  // Eight consecutive scheduled sessions, far enough in the past that the
  // seeded calendar does not collide with them.
  const sessionIds: string[] = [];
  for (let i = 0; i < SESSION_COUNT; i++) {
    const day = String(i + 1).padStart(2, "0");
    const date = `2023-03-${day}`;
    const existing = await pool.query<{ id: string }>(
      `select id from sessions where batch_id = $1 and scheduled_date = $2`,
      [batchId, date],
    );
    let sessionId: string;
    if (existing.rows[0]) {
      sessionId = existing.rows[0].id;
    } else {
      const [row] = await db
        .insert(sessions)
        .values({ batch_id: batchId, scheduled_date: date, status: "completed", topic: `H9 ${i}` })
        .returning({ id: sessions.id });
      sessionId = row!.id;
    }
    sessionIds.push(sessionId);
    await db.insert(attendance).values({
      session_id: sessionId,
      student_id: studentId,
      session_date: date,
      status: "present",
      marked_by: null,
      revision: 1,
    });
  }
  return { studentId, sessionIds };
}

async function streakLedger(studentId: string): Promise<{ sum: number; rows: number }> {
  const { rows } = await pool.query<{ total: string; n: string }>(
    `select coalesce(sum(points), 0)::text as total, count(*)::text as n
       from punya_transactions
      where student_id = $1 and source_entity_kind = 'attendance_streak'`,
    [studentId],
  );
  return { sum: Number(rows[0]!.total), rows: Number(rows[0]!.n) };
}

async function balance(studentId: string): Promise<number> {
  const { rows } = await pool.query<{ t: number }>(
    `select coalesce(total_points, 0) as t from punya_balances where student_id = $1`,
    [studentId],
  );
  return rows[0]?.t ?? 0;
}

describe("H9 — streak bonuses re-settle after a retroactive correction", () => {
  it("correcting S2 leaves exactly the bonuses the new history earns", async () => {
    const tag = `${Date.now().toString(36).slice(-6)}`;
    const { studentId, sessionIds } = await plantScenario(tag);

    // Eight attended → milestones at S4 and S8 → 2 x 20.
    const streak = await recomputeAndAwardStreak(studentId);
    expect(streak).toBe(8);
    expect(await streakLedger(studentId)).toMatchObject({ sum: 40, rows: 2 });

    // Retroactively correct S2 to absent, exactly as attendance-mark.ts does:
    // reverse first (at the new revision), then let post-process recompute.
    await db.transaction(async (tx) => {
      await reverseStreakBonusesFrom(tx, {
        studentId,
        sessionId: sessionIds[1]!,
        newRevision: 2,
      });
      await tx
        .update(attendance)
        .set({ status: "absent", revision: 2 })
        .where(
          and(eq(attendance.student_id, studentId), eq(attendance.session_id, sessionIds[1]!)),
        );
    });

    const after = await recomputeAndAwardStreak(studentId);
    // S3..S8 = six attended → one milestone, at S6.
    expect(after).toBe(6);

    const ledger = await streakLedger(studentId);
    // 40 awarded, 40 reversed, 20 re-awarded. Net 20 — NOT 60.
    expect(ledger.sum).toBe(20);
    // Two awards, two reversals, one re-award: the reverse-then-award pairs AT18 requires.
    expect(ledger.rows).toBe(5);
    expect(await balance(studentId)).toBe(20);
  });

  it("a second correction does not compound", async () => {
    const tag = `${Date.now().toString(36).slice(-6)}b`;
    const { studentId, sessionIds } = await plantScenario(tag);
    await recomputeAndAwardStreak(studentId);

    for (const idx of [1, 3]) {
      await db.transaction(async (tx) => {
        await reverseStreakBonusesFrom(tx, {
          studentId,
          sessionId: sessionIds[idx]!,
          newRevision: idx + 2,
        });
        await tx
          .update(attendance)
          .set({ status: "absent", revision: idx + 2 })
          .where(
            and(eq(attendance.student_id, studentId), eq(attendance.session_id, sessionIds[idx]!)),
          );
      });
      await recomputeAndAwardStreak(studentId);
    }

    // Marks now: S1 present, S2 absent, S3 present, S4 absent, S5..S8 present.
    // Longest trailing run is S5..S8 = 4 → exactly one milestone.
    const ledger = await streakLedger(studentId);
    expect(ledger.sum).toBe(20);
    expect(await balance(studentId)).toBe(20);
  });

  it("H8 — the bonus comes from punya_configs, not a constant", async () => {
    const tag = `${Date.now().toString(36).slice(-6)}c`;
    const { rows: before } = await pool.query<{ points: number }>(
      `select points from punya_configs where feature_key = 'attendance_streak' and city_id is null`,
    );
    expect(before[0]?.points).toBe(20);

    try {
      await pool.query(
        `update punya_configs set points = 30, updated_at = now()
          where feature_key = 'attendance_streak' and city_id is null`,
      );
      clearAttendancePointsCache();

      const { studentId } = await plantScenario(tag);
      await recomputeAndAwardStreak(studentId);
      // Two milestones at the edited rate.
      expect((await streakLedger(studentId)).sum).toBe(60);
    } finally {
      await pool.query(
        `update punya_configs set points = 20, updated_at = now()
          where feature_key = 'attendance_streak' and city_id is null`,
      );
      clearAttendancePointsCache();
    }
  });
});
