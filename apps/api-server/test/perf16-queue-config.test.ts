/**
 * PERF #16 — queue retries, failed-job retention, consecutive_check idempotency.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";
import { QUEUE_NAMES } from "@jp/shared/constants";
import {
  DEFAULT_JOB_OPTS,
  DEBOUNCED_REMOVE_ON_FAIL,
  workerOptsForQueue,
  dailyCronJobId,
  slotCronJobId,
} from "../src/lib/queues";
import { runConsecutiveAbsenceCheck } from "../src/services/consecutive-absence";
import * as notify from "../src/lib/notify";

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

describe("PERF #16 queue configuration", () => {
  it("a transient handler failure is retried (default attempts >= 3)", () => {
    expect(DEFAULT_JOB_OPTS.attempts).toBe(3);
    expect(DEFAULT_JOB_OPTS.backoff).toEqual({ type: "exponential", delay: 30_000 });
  });

  it("failed jobs are pruned by age on the debounced path", () => {
    expect(DEBOUNCED_REMOVE_ON_FAIL).toEqual({
      age: 7 * 24 * 3600,
      count: 5_000,
    });
  });

  it("long-running queues get an extended lockDuration", () => {
    const long = workerOptsForQueue(QUEUE_NAMES.ATTENDANCE_CONSECUTIVE_CHECK);
    expect(long.lockDuration).toBe(300_000);
    expect(long.stalledInterval).toBe(60_000);
    expect(long.maxStalledCount).toBe(2);

    const short = workerOptsForQueue(QUEUE_NAMES.PARENT_NOTIFY);
    expect(short.lockDuration).toBeUndefined();
  });

  it("cron jobIds are deterministic for the same day / slot", () => {
    expect(dailyCronJobId("consecutive", "2026-08-05")).toBe("consecutive:2026-08-05");
    const a = slotCronJobId("no_show", 15, new Date("2026-08-05T10:00:00Z"));
    const b = slotCronJobId("no_show", 15, new Date("2026-08-05T10:14:59Z"));
    const c = slotCronJobId("no_show", 15, new Date("2026-08-05T10:15:00Z"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("consecutive_check is idempotent within a day (re-run does not double-notify)", async () => {
    const notifySpy = vi.spyOn(notify, "notifyUsers").mockResolvedValue(undefined);
    vi.spyOn(notify, "sanchalakUserIdsForCentre").mockResolvedValue([]);
    vi.spyOn(notify, "cityAdminUserIdsForCentre").mockResolvedValue([]);

    const centre = await pool.query<{ id: string }>(
      `select id from centres where deleted_at is null limit 1`,
    );
    expect(centre.rows.length).toBe(1);
    const centreId = centre.rows[0]!.id;

    // Dedicated batch so "last 3 eligible sessions" are exactly the ones we plant.
    const batch = await pool.query<{ id: string }>(
      `insert into batches (centre_id, name, age_groups, day_of_week, start_time, end_time, capacity, status)
       values ($1, $2, array['bal']::age_group_enum[], array[1]::int[], '10:00', '11:00', 40, 'active')
       returning id`,
      [centreId, `PERF16-${Date.now()}`],
    );
    const batchId = batch.rows[0]!.id;

    const stu = await pool.query<{ id: string }>(
      `insert into students (centre_id, batch_id, full_name, student_code, status, dob, gender, age_group)
       values ($1, $2, 'PERF16 Consec', $3, 'active', '2015-01-01', 'male', 'bal')
       returning id`,
      [centreId, batchId, `P16C${Date.now()}`],
    );
    const studentId = stu.rows[0]!.id;

    const dates = ["2026-05-01", "2026-05-02", "2026-05-03"];
    const sessionIds: string[] = [];
    for (const d of dates) {
      const s = await pool.query<{ id: string }>(
        `insert into sessions (batch_id, scheduled_date, status, topic)
         values ($1, $2, 'completed', 'PERF16')
         returning id`,
        [batchId, d],
      );
      sessionIds.push(s.rows[0]!.id);
    }

    await pool.query(
      `insert into attendance (session_id, student_id, status, session_date, marked_at, revision)
       values
         ($1, $4, 'absent', '2026-05-01', now(), 1),
         ($2, $4, 'absent', '2026-05-02', now(), 1),
         ($3, $4, 'absent', '2026-05-03', now(), 1)`,
      [...sessionIds, studentId],
    );

    const first = await runConsecutiveAbsenceCheck();
    expect(first.flagged).toBeGreaterThanOrEqual(1);
    const callsAfterFirst = notifySpy.mock.calls.length;

    const second = await runConsecutiveAbsenceCheck();
    expect(second.flagged).toBe(0);
    expect(notifySpy.mock.calls.length).toBe(callsAfterFirst);

    const alerts = await pool.query<{ n: string }>(
      `select count(*)::text as n from consecutive_absence_alerts where student_id = $1`,
      [studentId],
    );
    expect(Number(alerts.rows[0]!.n)).toBe(1);

    await pool.query(`delete from students where id = $1`, [studentId]);
    await pool.query(`delete from batches where id = $1`, [batchId]);
    vi.restoreAllMocks();
  });
});
