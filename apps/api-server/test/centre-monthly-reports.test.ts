import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";
import { registerReportJobs } from "../src/jobs/report-jobs";
import { composeCentreMonthlySnapshot } from "../src/lib/centre-monthly-report";
import { rateToPercent1 } from "../src/lib/attendance-rate";

registerReportJobs();

let GHATKOPAR: string;
let KOTHRUD: string;
let BAL_BATCH: string;
let STUDENT_ID: string;
let SESSION_ID: string | null = null;
const createdAttendance: string[] = [];
const createdReports: string[] = [];

const FIXTURE_MONTH = "2024-06";
const EMPTY_MONTH = "2001-01";

async function pollReport(
  token: string,
  centreId: string,
  month: string,
  jobId: string,
  timeoutMs = 20_000,
): Promise<{ status: string; pdf_url: string | null; id: string; error_message: string | null }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const list = await request(app)
      .get(`/v1/admin/centres/${centreId}/reports?month=${month}`)
      .set(auth(token));
    expect(list.status).toBe(200);
    const row = (
      list.body.data.items as Array<{
        id: string;
        status: string;
        pdf_url: string | null;
        error_message: string | null;
      }>
    ).find((r) => r.id === jobId);
    if (row && (row.status === "ready" || row.status === "failed")) return row;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`report ${jobId} did not finish in time`);
}

beforeAll(async () => {
  GHATKOPAR = (
    await pool.query(`select id from centres where name = 'Ghatkopar Jain Pathshala'`)
  ).rows[0].id;
  KOTHRUD = (await pool.query(`select id from centres where name = 'Kothrud Jain Pathshala'`)).rows[0]
    .id;
  BAL_BATCH = (
    await pool.query(
      `select id from batches where name = 'Bal Batch - Sunday Morning' and centre_id = $1`,
      [GHATKOPAR],
    )
  ).rows[0].id;
  STUDENT_ID = (
    await pool.query(
      `select id from students where centre_id = $1 and status = 'active' and deleted_at is null limit 1`,
      [GHATKOPAR],
    )
  ).rows[0].id;

  // Fixture session + marks for FIXTURE_MONTH so AT5 has a countable denominator.
  const sessionId = randomUUID();
  await pool.query(
    `insert into sessions (
       id, batch_id, scheduled_date, scheduled_start_time, scheduled_end_time, status
     ) values (
       $1, $2, $3::date, '09:00', '11:00', 'completed'
     )
     on conflict (batch_id, scheduled_date) do update
       set status = 'completed'
     returning id`,
    [sessionId, BAL_BATCH, `${FIXTURE_MONTH}-09`],
  );
  const sess = await pool.query(
    `select id from sessions where batch_id = $1 and scheduled_date = $2::date`,
    [BAL_BATCH, `${FIXTURE_MONTH}-09`],
  );
  SESSION_ID = sess.rows[0].id as string;

  await pool.query(`delete from attendance where session_id = $1 and student_id = $2`, [
    SESSION_ID,
    STUDENT_ID,
  ]);
  const attId = randomUUID();
  await pool.query(
    `insert into attendance (id, session_id, student_id, status, session_date, marked_at, revision)
     values ($1, $2, $3, 'present', $4::date, now(), 1)`,
    [attId, SESSION_ID, STUDENT_ID, `${FIXTURE_MONTH}-09`],
  );
  createdAttendance.push(attId);
});

afterAll(async () => {
  if (createdReports.length) {
    await pool.query(`delete from centre_monthly_reports where id = any($1::uuid[])`, [
      createdReports,
    ]);
  }
  if (createdAttendance.length) {
    await pool.query(`delete from attendance where id = any($1::uuid[])`, [createdAttendance]);
  }
});

describe("centre monthly reports", () => {
  it("rejects sanchalak generating for a centre outside their scope", async () => {
    const sanch = await loginAs("sanchalak");
    const res = await request(app)
      .post(`/v1/admin/centres/${KOTHRUD}/reports/monthly`)
      .set(auth(sanch.token))
      .send({ month: FIXTURE_MONTH });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ERR_FORBIDDEN");
  });

  it("attendance % in the snapshot matches AT5 for a seeded fixture", async () => {
    const at5 = await pool.query(
      `select attendance_percentage_for_centres(
         array[$1]::uuid[], $2::date, $3::date
       ) as rate`,
      [GHATKOPAR, `${FIXTURE_MONTH}-01`, `${FIXTURE_MONTH}-30`],
    );
    const at5Rate = at5.rows[0].rate == null ? null : Number(at5.rows[0].rate);
    expect(at5Rate).not.toBeNull();

    const snap = await composeCentreMonthlySnapshot(GHATKOPAR, FIXTURE_MONTH);
    expect(snap.attendance_rate).toBeCloseTo(at5Rate!, 10);
    expect(snap.attendance_pct).toBe(rateToPercent1(at5Rate));
    expect(snap.no_sessions).toBe(false);
  });

  it("a month with no sessions reports no_sessions instead of dividing by zero", async () => {
    const snap = await composeCentreMonthlySnapshot(GHATKOPAR, EMPTY_MONTH);
    expect(snap.no_sessions).toBe(true);
    expect(snap.sessions.total).toBe(0);
    expect(snap.attendance_rate).toBeNull();
    expect(snap.attendance_pct).toBeNull();

    const sanch = await loginAs("sanchalak");
    const res = await request(app)
      .post(`/v1/admin/centres/${GHATKOPAR}/reports/monthly`)
      .set(auth(sanch.token))
      .send({ month: EMPTY_MONTH });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("queued");
    expect(res.body.data.job_id).toBeTruthy();
    createdReports.push(res.body.data.job_id);

    const done = await pollReport(sanch.token, GHATKOPAR, EMPTY_MONTH, res.body.data.job_id);
    expect(done.status, done.error_message ?? undefined).toBe("ready");
    expect(done.pdf_url).toBeTruthy();
    expect(String(done.pdf_url)).toMatch(/se=.*sig=/);

    const row = await pool.query(
      `select snapshot from centre_monthly_reports where id = $1`,
      [res.body.data.job_id],
    );
    const snapshot = row.rows[0].snapshot as { no_sessions: boolean; attendance_rate: number | null };
    expect(snapshot.no_sessions).toBe(true);
    expect(snapshot.attendance_rate).toBeNull();
  });

  it("lists reports scoped to the centre with signed URLs", async () => {
    const sanch = await loginAs("sanchalak");
    const gen = await request(app)
      .post(`/v1/admin/centres/${GHATKOPAR}/reports/monthly`)
      .set(auth(sanch.token))
      .send({ month: FIXTURE_MONTH });
    expect(gen.status).toBe(200);
    createdReports.push(gen.body.data.job_id);
    const done = await pollReport(sanch.token, GHATKOPAR, FIXTURE_MONTH, gen.body.data.job_id);
    expect(done.status).toBe("ready");

    const list = await request(app)
      .get(`/v1/admin/centres/${GHATKOPAR}/reports?month=${FIXTURE_MONTH}`)
      .set(auth(sanch.token));
    expect(list.status).toBe(200);
    expect(list.body.data.items.length).toBeGreaterThan(0);

    const out = await request(app)
      .get(`/v1/admin/centres/${KOTHRUD}/reports?month=${FIXTURE_MONTH}`)
      .set(auth(sanch.token));
    expect(out.status).toBe(403);
  });
});
