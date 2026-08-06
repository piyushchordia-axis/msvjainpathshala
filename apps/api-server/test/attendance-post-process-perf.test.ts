/**
 * FIX #12 / AT31 — attendance post-process must not scale DB work linearly
 * with marked students in the session.
 *
 * Batched design budget (no streak milestones → no per-student Punya):
 *   1 marked select + 1 holidays + 1 students + 1 session window + 1 marks
 *   + 1 unnest UPDATE  ≈ 6 statements.
 * Old path called recomputeAndAwardStreak per student (~5 queries each).
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  pool,
  db,
  sessions,
  students,
  attendance,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { withQueryCount } from "./helpers";
import {
  recomputeAndAwardStreak,
  runAttendancePostProcess,
} from "../src/services/attendance-post-process";
import * as queues from "../src/lib/queues";

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

describe("FIX #12 attendance post-process query bound", () => {
  it("post-process issues a bounded number of queries for a full session", async () => {
    const batchPick = await pool.query<{ batch_id: string; centre_id: string }>(
      `select b.id as batch_id, b.centre_id
         from batches b
        where b.deleted_at is null and b.status = 'active'
        limit 1`,
    );
    expect(batchPick.rows.length).toBe(1);
    const { batch_id: batchId, centre_id: centreId } = batchPick.rows[0]!;
    const suffix = `${Date.now()}`;
    const STUDENT_N = 30;

    const planted: string[] = [];
    for (let i = 0; i < STUDENT_N; i++) {
      const r = await pool.query<{ id: string }>(
        `insert into students (centre_id, batch_id, full_name, student_code, status, dob, gender, age_group)
         values ($1, $2, $3, $4, 'active', '2015-01-01', 'male', 'bal')
         returning id`,
        [centreId, batchId, `Fix12 Spy ${i}`, `F12${suffix}${i}`],
      );
      planted.push(r.rows[0]!.id);
    }

    const scheduledDate = "2024-08-12";
    const [session] = await db
      .insert(sessions)
      .values({
        batch_id: batchId,
        scheduled_date: scheduledDate,
        scheduled_start_time: "10:00:00",
        scheduled_end_time: "11:00:00",
        status: "completed",
        topic: `fix12-post-process-${suffix}`,
      })
      .onConflictDoUpdate({
        target: [sessions.batch_id, sessions.scheduled_date],
        set: { status: "completed", topic: `fix12-post-process-${suffix}` },
      })
      .returning({ id: sessions.id });

    const enqueueSpy = vi
      .spyOn(queues, "enqueueDebouncedJob")
      .mockResolvedValue(undefined);

    try {
      await db.delete(attendance).where(eq(attendance.session_id, session!.id));
      await db.insert(attendance).values(
        planted.map((student_id) => ({
          session_id: session!.id,
          student_id,
          status: "present" as const,
          session_date: scheduledDate,
          marked_method: "manual" as const,
          revision: 1,
        })),
      );

      // BEFORE — the pre-batch path still lives as recomputeAndAwardStreak (N×).
      const { count: beforeCount } = await withQueryCount(async () => {
        for (const id of planted) {
          await recomputeAndAwardStreak(id);
        }
      });

      // Reset streaks so AFTER is comparable (same work, not a no-op update).
      await db
        .update(students)
        .set({ attendance_streak: 0, attendance_streak_updated_at: null })
        .where(inArray(students.id, planted));

      const { count: afterCount } = await withQueryCount(() =>
        runAttendancePostProcess(session!.id),
      );

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          students: STUDENT_N,
          statements_before_n_plus_1: beforeCount,
          statements_after_batched: afterCount,
        }),
      );

      // Batched design: ~6 fixed reads/writes (+ 0 Punya when streak < 4).
      // Allow headroom for pool/setup noise; must stay O(1) vs N, not ~5N.
      const BATCHED_BUDGET = 20;
      expect(afterCount).toBeLessThanOrEqual(BATCHED_BUDGET);
      expect(afterCount).toBeLessThan(beforeCount / 2);
      expect(beforeCount).toBeGreaterThanOrEqual(STUDENT_N * 4);

      // AT31 debounce jobIds stay per (student, session) — one enqueue each.
      expect(enqueueSpy).toHaveBeenCalledTimes(STUDENT_N);

      const streaks = await db
        .select({ id: students.id, streak: students.attendance_streak })
        .from(students)
        .where(inArray(students.id, planted));
      for (const row of streaks) {
        expect(row.streak).toBe(1);
      }
    } finally {
      enqueueSpy.mockRestore();
      await db.delete(attendance).where(eq(attendance.session_id, session!.id));
      await db.delete(students).where(inArray(students.id, planted));
    }
  });
});
