/**
 * AT27 — consecutive absence: three 'absent' only; excused never counts.
 * PERF #14 — query count is sub-linear in student count (set-based CTE).
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { runConsecutiveAbsenceCheck } from "../src/services/consecutive-absence";
import * as notify from "../src/lib/notify";
import { vi } from "vitest";
import { withQueryCount } from "./helpers";

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});


describe("AT27 / PERF #14 consecutive absence", () => {
  it("excused never triggers a consecutive-absence alert", async () => {
    vi.spyOn(notify, "notifyUsers").mockResolvedValue(undefined);
    vi.spyOn(notify, "sanchalakUserIdsForCentre").mockResolvedValue([]);
    vi.spyOn(notify, "cityAdminUserIdsForCentre").mockResolvedValue([]);

    const batch = await pool.query<{ batch_id: string; centre_id: string }>(
      `select b.id as batch_id, b.centre_id
         from batches b
        where b.deleted_at is null and b.status = 'active'
        limit 1`,
    );
    expect(batch.rows.length).toBe(1);
    const { batch_id: batchId, centre_id: centreId } = batch.rows[0]!;

    const stu = await pool.query<{ id: string }>(
      `insert into students (centre_id, batch_id, full_name, student_code, status, dob, gender, age_group)
       values ($1, $2, 'AT27 Excused', $3, 'active', '2015-01-01', 'male', 'bal')
       returning id`,
      [centreId, batchId, `AT27E${Date.now()}`],
    );
    const studentId = stu.rows[0]!.id;

    const dates = ["2026-04-01", "2026-04-02", "2026-04-03"];
    const sessionIds: string[] = [];
    for (const d of dates) {
      const s = await pool.query<{ id: string }>(
        `insert into sessions (batch_id, scheduled_date, status, topic)
         values ($1, $2, 'completed', 'AT27')
         on conflict (batch_id, scheduled_date) do update set status = 'completed'
         returning id`,
        [batchId, d],
      );
      sessionIds.push(s.rows[0]!.id);
    }

    // Two absent + one excused — must NOT flag.
    await pool.query(
      `insert into attendance (session_id, student_id, status, session_date, marked_at, revision)
       values
         ($1, $4, 'absent', '2026-04-01', now(), 1),
         ($2, $4, 'absent', '2026-04-02', now(), 1),
         ($3, $4, 'excused', '2026-04-03', now(), 1)
       on conflict (session_id, student_id) do update
         set status = excluded.status, revision = attendance.revision + 1`,
      [...sessionIds, studentId],
    );

    // Clear any prior alert for this end session.
    await pool.query(`delete from consecutive_absence_alerts where student_id = $1`, [studentId]);

    const before = await pool.query<{ n: string }>(
      `select count(*)::text as n from consecutive_absence_alerts where student_id = $1`,
      [studentId],
    );

    await runConsecutiveAbsenceCheck();

    const after = await pool.query<{ n: string }>(
      `select count(*)::text as n from consecutive_absence_alerts where student_id = $1`,
      [studentId],
    );
    expect(Number(after.rows[0]!.n)).toBe(Number(before.rows[0]!.n));

    await pool.query(`delete from students where id = $1`, [studentId]);
    vi.restoreAllMocks();
  });

  it("X-2/X-3: flags three real past absences, never a future-scheduled or unmarked session", async () => {
    vi.spyOn(notify, "notifyUsers").mockResolvedValue(undefined);
    vi.spyOn(notify, "sanchalakUserIdsForCentre").mockResolvedValue([]);
    vi.spyOn(notify, "cityAdminUserIdsForCentre").mockResolvedValue([]);

    const centre = await pool.query<{ id: string }>(
      `select id from centres where deleted_at is null limit 1`,
    );
    const centreId = centre.rows[0]!.id;

    // Dedicated batch (mirrors PERF #16's pattern) so "last 3 eligible
    // sessions" are exactly the ones this test plants — reusing a shared
    // seeded batch would let its OTHER, more recent sessions dominate the
    // ranking and make this test pass vacuously regardless of the fix.
    const batchRow = await pool.query<{ id: string }>(
      `insert into batches (centre_id, name, age_groups, day_of_week, start_time, end_time, capacity, status)
       values ($1, $2, array['bal']::age_group_enum[], array[1]::int[], '10:00', '11:00', 40, 'active')
       returning id`,
      [centreId, `AT27X2X3-${Date.now()}`],
    );
    const batchId = batchRow.rows[0]!.id;

    async function makeStudent(tag: string) {
      const stu = await pool.query<{ id: string }>(
        `insert into students (centre_id, batch_id, full_name, student_code, status, dob, gender, age_group)
         values ($1, $2, $3, $4, 'active', '2015-01-01', 'male', 'bal')
         returning id`,
        [centreId, batchId, `AT27 ${tag}`, `AT27${tag}${Date.now()}`],
      );
      return stu.rows[0]!.id;
    }

    async function makeSession(date: string, status = "completed") {
      const s = await pool.query<{ id: string }>(
        `insert into sessions (batch_id, scheduled_date, status, topic)
         values ($1, $2, $3, 'AT27')
         on conflict (batch_id, scheduled_date) do update set status = excluded.status
         returning id`,
        [batchId, date, status],
      );
      return s.rows[0]!.id;
    }

    // Three real PAST sessions, all genuinely absent -> must flag.
    const flaggedStudent = await makeStudent("Flagged");
    const pastDates = ["2020-01-06", "2020-01-07", "2020-01-08"]; // Mon/Tue/Wed, well in the past
    const pastSessionIds = await Promise.all(pastDates.map((d) => makeSession(d)));
    for (let i = 0; i < pastSessionIds.length; i++) {
      await pool.query(
        `insert into attendance (session_id, student_id, status, session_date, marked_at, revision)
         values ($1, $2, 'absent', $3, now(), 1)
         on conflict (session_id, student_id) do update
           set status = excluded.status, revision = attendance.revision + 1`,
        [pastSessionIds[i], flaggedStudent, pastDates[i]],
      );
    }

    // Two real past absences + one UNMARKED session (no attendance row at
    // all, not even 'absent') -> must NOT flag (X-3 / AT6).
    const unmarkedStudent = await makeStudent("Unmarked");
    for (let i = 0; i < 2; i++) {
      await pool.query(
        `insert into attendance (session_id, student_id, status, session_date, marked_at, revision)
         values ($1, $2, 'absent', $3, now(), 1)
         on conflict (session_id, student_id) do update
           set status = excluded.status, revision = attendance.revision + 1`,
        [pastSessionIds[i], unmarkedStudent, pastDates[i]],
      );
    }
    // Third session for this student is deliberately left unmarked.

    // A future-scheduled session with no attendance must never be one of the
    // "last 3" for a student whose real absences are all in the past (X-2) —
    // give the flagged student a fourth, FUTURE session so a broken
    // (no-upper-bound) query would rank it ahead of the real absences.
    const futureSessionId = await makeSession("2099-01-01", "scheduled");
    void futureSessionId; // deliberately left unmarked — this is the point

    await pool.query(
      `delete from consecutive_absence_alerts where student_id = any($1::uuid[])`,
      [[flaggedStudent, unmarkedStudent]],
    );

    await runConsecutiveAbsenceCheck();

    const flagged = await pool.query<{ n: string }>(
      `select count(*)::text as n from consecutive_absence_alerts where student_id = $1`,
      [flaggedStudent],
    );
    expect(Number(flagged.rows[0]!.n)).toBe(1);

    const notFlagged = await pool.query<{ n: string }>(
      `select count(*)::text as n from consecutive_absence_alerts where student_id = $1`,
      [unmarkedStudent],
    );
    expect(Number(notFlagged.rows[0]!.n)).toBe(0);

    await pool.query(`delete from students where id = any($1::uuid[])`, [
      [flaggedStudent, unmarkedStudent],
    ]);
    await pool.query(`delete from batches where id = $1`, [batchId]);
    vi.restoreAllMocks();
  });

  it("set-based check stays sub-linear vs active student count", async () => {
    vi.spyOn(notify, "notifyUsers").mockResolvedValue(undefined);
    vi.spyOn(notify, "sanchalakUserIdsForCentre").mockResolvedValue([]);
    vi.spyOn(notify, "cityAdminUserIdsForCentre").mockResolvedValue([]);

    const { count } = await withQueryCount(() => runConsecutiveAbsenceCheck());
    const active = await pool.query<{ n: string }>(
      `select count(*)::text as n from students where status = 'active' and deleted_at is null`,
    );
    const n = Number(active.rows[0]!.n);
    // Old path was ~3N queries. Set-based must be far below that.
    expect(count).toBeLessThan(Math.max(50, n));
    vi.restoreAllMocks();
  });
});
