/**
 * AT5 edge-case suite — cancelled, holiday, unmarked, partial, excused, deactivation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, stopHarness, type Harness } from "./harness";

describe("attendance_percentage (AT5)", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  }, 180_000);

  afterAll(async () => {
    await stopHarness();
  });

  it("matches exact expected rates for the edge-case batch", async () => {
    const client = await h.pool.connect();
    try {
      const { centreId, batchId, studentIds } = h.fixtures;
      const focus = studentIds[0]!;

      // Avoid clashing with the harness session on 2026-03-15.
      await client.query(`delete from attendance where session_id = $1`, [h.fixtures.sessionId]);
      await client.query(`delete from sessions where id = $1`, [h.fixtures.sessionId]);

      await client.query(
        `insert into centre_holidays (centre_id, holiday_date, reason) values ($1, '2026-03-10', 'Holi')`,
        [centreId],
      );

      const mkSession = async (date: string, status = "completed") => {
        const r = await client.query(
          `insert into sessions (batch_id, scheduled_date, status)
           values ($1, $2, $3) returning id`,
          [batchId, date, status],
        );
        return r.rows[0].id as string;
      };

      const sCancelled = await mkSession("2026-03-01", "cancelled");
      const sHoliday = await mkSession("2026-03-10", "completed");
      const sUnmarked = await mkSession("2026-03-12", "completed");
      const sPartial = await mkSession("2026-03-15", "completed");
      const sExcused = await mkSession("2026-03-17", "completed");
      const sAbsent = await mkSession("2026-03-18", "completed");
      const sBeforeDeact = await mkSession("2026-03-20", "completed");
      const sAfterDeact = await mkSession("2026-03-25", "completed");

      await client.query(
        `insert into attendance (session_id, student_id, status, session_date, revision)
         values ($1, $2, 'present', '2026-03-01', 1)`,
        [sCancelled, focus],
      );
      await client.query(
        `insert into attendance (session_id, student_id, status, session_date, revision)
         values ($1, $2, 'present', '2026-03-10', 1)`,
        [sHoliday, focus],
      );

      for (let i = 0; i < 15; i++) {
        await client.query(
          `insert into attendance (session_id, student_id, status, session_date, revision)
           values ($1, $2, 'present', '2026-03-15', 1)`,
          [sPartial, studentIds[i]],
        );
      }

      await client.query(
        `insert into attendance (session_id, student_id, status, session_date, revision)
         values ($1, $2, 'excused', '2026-03-17', 1)`,
        [sExcused, focus],
      );
      await client.query(
        `insert into attendance (session_id, student_id, status, session_date, revision)
         values ($1, $2, 'absent', '2026-03-18', 1)`,
        [sAbsent, focus],
      );
      await client.query(
        `insert into attendance (session_id, student_id, status, session_date, revision)
         values ($1, $2, 'present', '2026-03-20', 1)`,
        [sBeforeDeact, focus],
      );

      await client.query(
        `update students set status = 'inactive',
           deactivated_at = timestamptz '2026-03-22 06:00:00+05:30'
         where id = $1`,
        [focus],
      );

      await client.query(
        `insert into attendance (session_id, student_id, status, session_date, revision)
         values ($1, $2, 'absent', '2026-03-25', 1)`,
        [sAfterDeact, focus],
      );

      /*
       * Focus countable: holiday present, partial present, absent(18), before-deact present
       * = 3 present + 1 absent → 0.75
       * Excluded: cancelled present, excused, after-deact absent; unmarked session none.
       */
      const rateRes = await client.query(
        `select attendance_percentage($1::uuid, '2026-03-01'::date, '2026-03-31'::date) as rate`,
        [focus],
      );
      expect(Number(rateRes.rows[0].rate)).toBeCloseTo(0.75, 5);

      const unmarkedStudent = studentIds[19]!;
      const unmarkedRate = await client.query(
        `select attendance_percentage($1::uuid, '2026-03-01'::date, '2026-03-31'::date) as rate`,
        [unmarkedStudent],
      );
      expect(unmarkedRate.rows[0].rate).toBeNull();

      const dayRate = await client.query(
        `select attendance_percentage_for_centres(array[$1]::uuid[], '2026-03-15'::date, '2026-03-15'::date) as rate`,
        [centreId],
      );
      expect(Number(dayRate.rows[0].rate)).toBeCloseTo(1.0, 5);

      void sUnmarked;
    } finally {
      client.release();
    }
  });
});
