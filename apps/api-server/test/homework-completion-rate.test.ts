import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";
import request from "supertest";
import app from "../src/app";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

afterAll(async () => {
  await pool.end();
});

beforeAll(async () => {
  // Ensure F4 migration is applied (idempotent CREATE OR REPLACE / DROP+CREATE).
  const sql = readFileSync(
    join(__dirname, "../../../lib/db/migrations/0026_homework_completion_rate.sql"),
    "utf8",
  );
  await pool.query(sql);
});

async function firstChildId(parentToken: string): Promise<string> {
  const children = await request(app).get("/v1/me/children").set(auth(parentToken));
  expect(children.status).toBe(200);
  return children.body.data.items[0].id as string;
}

describe("homework_completion_rate (F4)", () => {
  it("the function returns the hand-calculated rate for a known fixture", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);

    const batch = await pool.query<{ batch_id: string; centre_id: string }>(
      `select batch_id, centre_id from students where id = $1`,
      [studentId],
    );
    const batchId = batch.rows[0]!.batch_id;
    const centreId = batch.rows[0]!.centre_id;

    // Isolate: soft-delete any live assignments for this batch in the window.
    await pool.query(
      `update homework_assignments set deleted_at = now()
        where batch_id = $1 and deleted_at is null
          and due_date between '2099-01-01' and '2099-01-31'`,
      [batchId],
    );

    const a1 = await pool.query<{ id: string }>(
      `insert into homework_assignments (batch_id, title, due_date, created_by)
       values ($1, 'F4 rate A', '2099-01-10', $2) returning id`,
      [batchId, admin.user.id],
    );
    const a2 = await pool.query<{ id: string }>(
      `insert into homework_assignments (batch_id, title, due_date, created_by)
       values ($1, 'F4 rate B', '2099-01-20', $2) returning id`,
      [batchId, admin.user.id],
    );
    const a3 = await pool.query<{ id: string }>(
      `insert into homework_assignments (batch_id, title, due_date, created_by)
       values ($1, 'F4 rate C', '2099-01-25', $2) returning id`,
      [batchId, admin.user.id],
    );
    const a4 = await pool.query<{ id: string }>(
      `insert into homework_assignments (batch_id, title, due_date, created_by)
       values ($1, 'F4 rate D', '2099-01-28', $2) returning id`,
      [batchId, admin.user.id],
    );

    // 4 rows for this student: submitted, pending, returned, approved → 3/4 = 0.75
    await pool.query(
      `insert into homework_submissions (assignment_id, student_id, status) values
         ($1, $5, 'submitted'),
         ($2, $5, 'pending'),
         ($3, $5, 'returned'),
         ($4, $5, 'approved')
       on conflict (assignment_id, student_id) do update
         set status = excluded.status`,
      [a1.rows[0]!.id, a2.rows[0]!.id, a3.rows[0]!.id, a4.rows[0]!.id, studentId],
    );

    const rate = await pool.query<{ rate: string | null }>(
      `select homework_completion_rate($1::uuid, '2099-01-01'::date, '2099-01-31'::date) as rate`,
      [studentId],
    );
    expect(Number(rate.rows[0]!.rate)).toBeCloseTo(0.75, 5);

    const centreRate = await pool.query<{ rate: string | null }>(
      `select homework_completion_rate_for_centres(
         array[$1]::uuid[], '2099-01-01'::date, '2099-01-31'::date
       ) as rate`,
      [centreId],
    );
    // Centre may include other students' auto-created pending rows for these assignments.
    // Prefer student-scoped assertion as the hand-calculated fixture; centre rate must be non-null.
    expect(centreRate.rows[0]!.rate).not.toBeNull();

    await pool.query(`delete from homework_assignments where id = any($1::uuid[])`, [
      [a1.rows[0]!.id, a2.rows[0]!.id, a3.rows[0]!.id, a4.rows[0]!.id],
    ]);
  });

  it("a centre with no assignments returns NULL, not 0", async () => {
    const rate = await pool.query<{ rate: string | null }>(
      `select homework_completion_rate_for_centres(
         array['00000000-0000-0000-0000-000000000099']::uuid[],
         '2098-01-01'::date,
         '2098-01-31'::date
       ) as rate`,
    );
    expect(rate.rows[0]!.rate).toBeNull();
  });

  it("the refreshed view matches the function called directly", async () => {
    // Need at least one attendance row in a month so the MV has a centre/month row.
    const sample = await pool.query<{ centre_id: string; month: string }>(
      `select b.centre_id::text, date_trunc('month', s.scheduled_date::timestamp)::date::text as month
         from attendance a
         join sessions s on s.id = a.session_id
         join batches b on b.id = s.batch_id
        where s.status <> 'cancelled'
        limit 1`,
    );
    if (sample.rows.length === 0) {
      // Seeded DBs always have attendance; skip soft if empty.
      expect(sample.rows.length).toBeGreaterThan(0);
      return;
    }
    const { centre_id, month } = sample.rows[0]!;
    const monthStart = month.slice(0, 10);
    const [y, m] = monthStart.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
    const monthEnd = `${monthStart.slice(0, 8)}${String(lastDay).padStart(2, "0")}`;

    await pool.query(`REFRESH MATERIALIZED VIEW mv_centre_engagement`);

    const fromFn = await pool.query<{ rate: string | null }>(
      `select homework_completion_rate_for_centres(
         array[$1]::uuid[], $2::date, $3::date
       ) as rate`,
      [centre_id, monthStart, monthEnd],
    );
    const fromMv = await pool.query<{ homework_completion_rate: string | null }>(
      `select homework_completion_rate from mv_centre_engagement
        where centre_id = $1::uuid and month = $2::date`,
      [centre_id, monthStart],
    );

    expect(fromMv.rows.length).toBeGreaterThan(0);
    const a = fromFn.rows[0]!.rate;
    const b = fromMv.rows[0]!.homework_completion_rate;
    if (a == null && b == null) {
      expect(b).toBeNull();
    } else {
      expect(Number(b)).toBeCloseTo(Number(a), 5);
    }
  });
});
