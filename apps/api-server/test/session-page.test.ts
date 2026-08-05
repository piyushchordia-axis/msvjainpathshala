/**
 * PERF #7 — page-then-LATERAL session lists + bounded /today queries.
 */
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool, db, sessions, batches, centres, attendance, students } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { loginAs, auth } from "./helpers";
import {
  pageSessionsWithAttendanceCounts,
  kolkataDateMinusDays,
} from "../src/lib/session-page";

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

/** Count SQL statements issued via pool.query while `fn` runs. */
async function withQueryCount<T>(fn: () => Promise<T>): Promise<{ result: T; queries: number }> {
  let queries = 0;
  const origQuery = pool.query.bind(pool);
  // drizzle-orm/node-postgres talks to the Pool via .query, not .connect.
  (pool as { query: typeof pool.query }).query = ((...qArgs: unknown[]) => {
    queries += 1;
    return (origQuery as (...a: unknown[]) => unknown)(...qArgs);
  }) as typeof pool.query;
  try {
    const result = await fn();
    return { result, queries };
  } finally {
    pool.query = origQuery;
  }
}

describe("session list LATERAL paging (PERF #7)", () => {
  it("the centre attendance log returns correct counts for the page", async () => {
    const { token } = await loginAs("super_admin");

    // Pick an active centre+batch with at least one student.
    const [ctx] = await db
      .select({
        centre_id: centres.id,
        batch_id: batches.id,
      })
      .from(batches)
      .innerJoin(centres, eq(centres.id, batches.centre_id))
      .where(and(isNull(batches.deleted_at), isNull(centres.deleted_at)))
      .limit(1);
    expect(ctx).toBeTruthy();

    const studentRows = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.batch_id, ctx!.batch_id), eq(students.status, "active")))
      .limit(4);
    expect(studentRows.length).toBeGreaterThanOrEqual(1);

    const planted: string[] = [];
    const expected: Array<{ present: number; total: number }> = [];

    // Three sessions with known present/absent/late/excused mixes (one per calendar day —
    // UNIQUE (batch_id, scheduled_date)).
    const mixes: Array<Array<"present" | "absent" | "late" | "excused">> = [
      ["present", "absent"],
      ["late", "excused", "present"],
      ["absent", "absent"],
    ];

    const fromDay = kolkataDateMinusDays(5);
    const toDay = kolkataDateMinusDays(3);

    for (let i = 0; i < mixes.length; i++) {
      const mix = mixes[i]!;
      const sessionDay = kolkataDateMinusDays(5 - i);
      const [row] = await db
        .insert(sessions)
        .values({
          batch_id: ctx!.batch_id,
          scheduled_date: sessionDay,
          scheduled_start_time: `10:00:00`,
          scheduled_end_time: `11:00:00`,
          status: "completed",
          topic: `perf7-count-${i}`,
        })
        .onConflictDoUpdate({
          target: [sessions.batch_id, sessions.scheduled_date],
          set: { topic: `perf7-count-${i}`, status: "completed" },
        })
        .returning({ id: sessions.id });
      planted.push(row!.id);

      await pool.query(`delete from attendance where session_id = $1`, [row!.id]);

      let present = 0;
      let total = 0;
      for (let j = 0; j < mix.length && j < studentRows.length; j++) {
        const status = mix[j]!;
        await db.insert(attendance).values({
          session_id: row!.id,
          student_id: studentRows[j]!.id,
          status,
          session_date: sessionDay,
          marked_method: "manual",
          revision: 1,
        });
        total += 1;
        if (status === "present" || status === "late") present += 1;
      }
      expected.push({ present, total });
    }

    try {
      const res = await request(app)
        .get(`/v1/admin/attendance/centres/${ctx!.centre_id}/log`)
        .query({ from: fromDay, to: toDay, limit: 50 })
        .set(auth(token));
      expect(res.status).toBe(200);

      const items = res.body.data.items as Array<{
        id: string;
        present_count: number;
        total_count: number;
      }>;
      expect(res.body.meta.window_days).toBeNull();

      for (let i = 0; i < planted.length; i++) {
        const hit = items.find((it) => it.id === planted[i]);
        expect(hit, `session ${planted[i]} missing from page`).toBeTruthy();
        expect(hit!.present_count).toBe(expected[i]!.present);
        expect(hit!.total_count).toBe(expected[i]!.total);
      }

      // Direct helper — same arithmetic (AT5 FILTER).
      const direct = await pageSessionsWithAttendanceCounts({
        filters: [
          eq(batches.centre_id, ctx!.centre_id),
          isNull(batches.deleted_at),
          sql`${sessions.scheduled_date} >= ${fromDay}`,
          sql`${sessions.scheduled_date} <= ${toDay}`,
        ],
        limit: 50,
        windowDays: null,
      });
      for (let i = 0; i < planted.length; i++) {
        const hit = direct.items.find((it) => it.id === planted[i]);
        expect(hit!.present_count).toBe(expected[i]!.present);
        expect(hit!.total_count).toBe(expected[i]!.total);
      }
    } finally {
      await pool.query(`delete from attendance where session_id = any($1::uuid[])`, [planted]);
      await pool.query(
        `delete from sessions where id = any($1::uuid[]) and topic like 'perf7-count-%'`,
        [planted],
      );
    }
  });

  it("query count does not scale with total session count", async () => {
    const [ctx] = await db
      .select({ centre_id: centres.id, batch_id: batches.id })
      .from(batches)
      .innerJoin(centres, eq(centres.id, batches.centre_id))
      .where(and(isNull(batches.deleted_at), isNull(centres.deleted_at)))
      .limit(1);
    expect(ctx).toBeTruthy();

    // Far enough in the past that we don't collide with seed/materialised rows.
    const baseOffset = 200;
    const planted: string[] = [];
    const windowFrom = kolkataDateMinusDays(baseOffset + 120);
    const windowTo = kolkataDateMinusDays(baseOffset);

    async function plant(n: number) {
      const start = planted.length;
      for (let i = 0; i < n; i++) {
        const sessionDay = kolkataDateMinusDays(baseOffset + start + i);
        const [row] = await db
          .insert(sessions)
          .values({
            batch_id: ctx!.batch_id,
            scheduled_date: sessionDay,
            scheduled_start_time: "09:00:00",
            scheduled_end_time: "10:00:00",
            status: "scheduled",
            topic: `perf7-qcount-${start + i}`,
          })
          .onConflictDoUpdate({
            target: [sessions.batch_id, sessions.scheduled_date],
            set: { topic: `perf7-qcount-${start + i}` },
          })
          .returning({ id: sessions.id });
        planted.push(row!.id);
      }
    }

    try {
      await plant(10);
      const { queries: q10 } = await withQueryCount(() =>
        pageSessionsWithAttendanceCounts({
          filters: [
            eq(batches.centre_id, ctx!.centre_id),
            isNull(batches.deleted_at),
            sql`${sessions.scheduled_date} >= ${windowFrom}`,
            sql`${sessions.scheduled_date} <= ${windowTo}`,
          ],
          limit: 50,
          windowDays: null,
        }),
      );

      await plant(90); // 100 total
      const { queries: q100 } = await withQueryCount(() =>
        pageSessionsWithAttendanceCounts({
          filters: [
            eq(batches.centre_id, ctx!.centre_id),
            isNull(batches.deleted_at),
            sql`${sessions.scheduled_date} >= ${windowFrom}`,
            sql`${sessions.scheduled_date} <= ${windowTo}`,
          ],
          limit: 50,
          windowDays: null,
        }),
      );

      // Page query + LATERAL count query — fixed at 2 regardless of table size.
      expect(q10).toBe(2);
      expect(q100).toBe(q10);
    } finally {
      if (planted.length) {
        await pool.query(
          `delete from sessions where id = any($1::uuid[]) and topic like 'perf7-qcount-%'`,
          [planted],
        );
      }
    }
  });

  it("GET /v1/sessions/today issues a bounded number of queries", async () => {
    const { token } = await loginAs("super_admin");
    const dayRes = await pool.query<{ d: string }>(
      `select to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as d`,
    );
    const day = dayRes.rows[0]!.d;

    const [ctx] = await db
      .select({ centre_id: centres.id, batch_id: batches.id })
      .from(batches)
      .innerJoin(centres, eq(centres.id, batches.centre_id))
      .where(and(isNull(batches.deleted_at), isNull(centres.deleted_at)))
      .limit(1);
    expect(ctx).toBeTruthy();

    const siblingBatches = await pool.query<{ id: string }>(
      `select id from batches where centre_id = $1 and deleted_at is null limit 60`,
      [ctx!.centre_id],
    );
    const planted: string[] = [];

    async function ensureSessions(n: number) {
      for (const b of siblingBatches.rows.slice(0, n)) {
        const r = await pool.query<{ id: string }>(
          `insert into sessions (batch_id, scheduled_date, scheduled_start_time, scheduled_end_time, status, topic)
           values ($1, $2::date, '09:00:00', '10:00:00', 'scheduled', $3)
           on conflict (batch_id, scheduled_date) do update set topic = excluded.topic
           returning id`,
          [b.id, day, `perf7-today-${Date.now()}-${b.id}`],
        );
        planted.push(r.rows[0]!.id);
      }
    }

    try {
      await ensureSessions(Math.min(5, siblingBatches.rows.length));
      const { queries: q5 } = await withQueryCount(async () => {
        const res = await request(app)
          .get("/v1/sessions/today")
          .query({ centre_id: ctx!.centre_id, limit: 5 })
          .set(auth(token));
        expect(res.status).toBe(200);
        expect(res.body.meta.roster_included).toBe(true);
        return res.body;
      });

      await ensureSessions(Math.min(50, siblingBatches.rows.length));
      const { queries: q50 } = await withQueryCount(async () => {
        const res = await request(app)
          .get("/v1/sessions/today")
          .query({ centre_id: ctx!.centre_id, limit: 50 })
          .set(auth(token));
        expect(res.status).toBe(200);
        return res.body;
      });

      // Page + LATERAL + students + attendance + absences — fixed; must not be 1+N.
      expect(q5).toBeLessThanOrEqual(12);
      expect(q50).toBe(q5);
      expect(q50).toBeLessThan(20);
    } finally {
      if (planted.length) {
        await pool.query(
          `delete from sessions where id = any($1::uuid[]) and topic like 'perf7-today-%'`,
          [planted],
        );
      }
    }
  });
});
