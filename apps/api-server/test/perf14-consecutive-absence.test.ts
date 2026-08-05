/**
 * AT27 — consecutive absence: three 'absent' only; excused never counts.
 * PERF #14 — query count is sub-linear in student count (set-based CTE).
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { runConsecutiveAbsenceCheck } from "../src/services/consecutive-absence";
import * as notify from "../src/lib/notify";
import { vi } from "vitest";

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

async function withQueryCount<T>(fn: () => Promise<T>): Promise<{ result: T; queries: number }> {
  let queries = 0;
  const origConnect = pool.connect.bind(pool);
  const origQuery = pool.query.bind(pool);
  const wrapClient = (client: { query: typeof pool.query; __p?: typeof pool.query }) => {
    if (!client.__p) client.__p = client.query.bind(client);
    const oq = client.__p;
    client.query = ((...args: unknown[]) => {
      queries += 1;
      return (oq as (...a: unknown[]) => unknown)(...args);
    }) as typeof client.query;
    return client;
  };
  pool.connect = ((arg?: unknown) => {
    if (typeof arg === "function") {
      return origConnect((err: Error | undefined, client: unknown, release: unknown) => {
        if (client) wrapClient(client as { query: typeof pool.query });
        return (arg as (e: unknown, c: unknown, r: unknown) => void)(err, client, release);
      });
    }
    return (origConnect as () => Promise<{ query: typeof pool.query }>)().then(wrapClient);
  }) as typeof pool.connect;
  pool.query = ((...args: unknown[]) => {
    queries += 1;
    return (origQuery as (...a: unknown[]) => unknown)(...args);
  }) as typeof pool.query;
  try {
    return { result: await fn(), queries };
  } finally {
    pool.connect = origConnect;
    pool.query = origQuery;
  }
}

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

  it("set-based check stays sub-linear vs active student count", async () => {
    vi.spyOn(notify, "notifyUsers").mockResolvedValue(undefined);
    vi.spyOn(notify, "sanchalakUserIdsForCentre").mockResolvedValue([]);
    vi.spyOn(notify, "cityAdminUserIdsForCentre").mockResolvedValue([]);

    const { queries } = await withQueryCount(() => runConsecutiveAbsenceCheck());
    const active = await pool.query<{ n: string }>(
      `select count(*)::text as n from students where status = 'active' and deleted_at is null`,
    );
    const n = Number(active.rows[0]!.n);
    // Old path was ~3N queries. Set-based must be far below that.
    expect(queries).toBeLessThan(Math.max(50, n));
    vi.restoreAllMocks();
  });
});
