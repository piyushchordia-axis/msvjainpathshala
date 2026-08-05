/**
 * PERF #10 BEFORE/AFTER statement-count measurement (30-student roster).
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool, db, sessions, students, attendance, punya_transactions, users } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { ulid } from "../src/lib/ulid";
import { markAttendance } from "../src/services/attendance-mark";
import { withQueryCount } from "./helpers";

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});


describe("PERF #10 mark statement count", () => {
  it("records statement count for 30-student fresh + correction", async () => {
    const batchPick = await pool.query<{ batch_id: string; centre_id: string }>(
      `select b.id as batch_id, b.centre_id
       from batches b
       where b.deleted_at is null and b.status = 'active'
       limit 1`,
    );
    expect(batchPick.rows.length).toBe(1);
    const { batch_id: batchId, centre_id: centreId } = batchPick.rows[0]!;

    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.role, "super_admin")).limit(1);
    const planted: string[] = [];
    for (let i = 0; i < 30; i++) {
      const r = await pool.query<{ id: string }>(
        `insert into students (centre_id, batch_id, full_name, student_code, status, dob, gender, age_group)
         values ($1, $2, $3, $4, 'active', '2015-01-01', 'male', 'bal')
         returning id`,
        [centreId, batchId, `Perf10 Spy ${i}`, `P10SPY${Date.now()}${i}`],
      );
      planted.push(r.rows[0]!.id);
    }

    const scheduledDate = "2024-07-21";
    const [session] = await db
      .insert(sessions)
      .values({
        batch_id: batchId,
        scheduled_date: scheduledDate,
        scheduled_start_time: "10:00:00",
        scheduled_end_time: "11:00:00",
        status: "in_progress",
        topic: "perf10-spy-count",
      })
      .onConflictDoUpdate({
        target: [sessions.batch_id, sessions.scheduled_date],
        set: { status: "in_progress", topic: "perf10-spy-count" },
      })
      .returning({ id: sessions.id });

    try {
      await db.delete(attendance).where(eq(attendance.session_id, session!.id));
      await db
        .delete(punya_transactions)
        .where(eq(punya_transactions.source_entity_id, session!.id));

      const marks = (status: "present" | "absent") =>
        planted.map((id) => ({ student_id: id, status, client_op_id: ulid() }));

      const { count: fresh } = await withQueryCount(() =>
        markAttendance({
          sessionId: session!.id,
          userId: user!.id,
          markedAt: new Date(`${scheduledDate}T10:00:00.000+05:30`),
          submissionOpId: ulid(),
          marks: marks("present"),
        }),
      );

      const { count: correction } = await withQueryCount(() =>
        markAttendance({
          sessionId: session!.id,
          userId: user!.id,
          markedAt: new Date(`${scheduledDate}T11:00:00.000+05:30`),
          submissionOpId: ulid(),
          marks: marks("absent"),
        }),
      );

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          students: 30,
          statements_fresh_present: fresh,
          statements_correction_present_to_absent: correction,
        }),
      );

      expect(fresh).toBeGreaterThan(0);
      expect(correction).toBeGreaterThan(0);
    } finally {
      await pool.query(`delete from attendance where session_id = $1`, [session!.id]);
      await pool.query(
        `delete from punya_transactions where source_entity_id = $1::uuid`,
        [session!.id],
      );
      await pool.query(`delete from punya_balances where student_id = any($1::uuid[])`, [planted]);
      await pool.query(`delete from students where id = any($1::uuid[])`, [planted]);
      await pool.query(`delete from sessions where id = $1 and topic = 'perf10-spy-count'`, [
        session!.id,
      ]);
    }
  }, 120_000);
});
