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

describe("centre monthly reports — per-batch AT5 reconciliation", () => {
  /** Isolated month so Ghatkopar centre rate == our single-batch rate. */
  const RECON_MONTH = "2023-05";
  const FROM = `${RECON_MONTH}-01`;
  const TO = `${RECON_MONTH}-31`;

  let reconBatchId: string;
  let emptyBatchId: string;
  let cancelledBatchId: string;
  let holidayBatchId: string;
  let reconStudentId: string;
  const cleanupSessionIds: string[] = [];
  const cleanupAttIds: string[] = [];
  const cleanupHwAssignmentIds: string[] = [];
  const cleanupHolidayIds: string[] = [];
  const cleanupBatchIds: string[] = [];
  const cleanupStudentIds: string[] = [];

  async function upsertSession(
    batchId: string,
    date: string,
    status: string,
  ): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `insert into sessions (
         id, batch_id, scheduled_date, scheduled_start_time, scheduled_end_time, status
       ) values ($1, $2, $3::date, '09:00', '11:00', $4)
       on conflict (batch_id, scheduled_date) do update
         set status = excluded.status
       returning id`,
      [id, batchId, date, status],
    );
    const row = await pool.query(
      `select id from sessions where batch_id = $1 and scheduled_date = $2::date`,
      [batchId, date],
    );
    const sid = row.rows[0].id as string;
    cleanupSessionIds.push(sid);
    return sid;
  }

  async function mark(
    sessionId: string,
    studentId: string,
    status: string,
    sessionDate: string,
  ): Promise<void> {
    const id = randomUUID();
    await pool.query(`delete from attendance where session_id = $1 and student_id = $2`, [
      sessionId,
      studentId,
    ]);
    await pool.query(
      `insert into attendance (id, session_id, student_id, status, session_date, marked_at, revision)
       values ($1, $2, $3, $4, $5::date, now(), 1)`,
      [id, sessionId, studentId, status, sessionDate],
    );
    cleanupAttIds.push(id);
  }

  beforeAll(async () => {
    const b1 = await pool.query(
      `insert into batches (centre_id, name, age_groups, day_of_week, start_time, end_time, capacity, status)
       values ($1, 'AT5 recon batch', array['bal']::age_group_enum[], array[0], '09:00', '11:00', 30, 'active')
       returning id`,
      [GHATKOPAR],
    );
    reconBatchId = b1.rows[0].id;
    cleanupBatchIds.push(reconBatchId);

    const b2 = await pool.query(
      `insert into batches (centre_id, name, age_groups, day_of_week, start_time, end_time, capacity, status)
       values ($1, 'AT5 empty batch', array['bal']::age_group_enum[], array[0], '09:00', '11:00', 30, 'active')
       returning id`,
      [GHATKOPAR],
    );
    emptyBatchId = b2.rows[0].id;
    cleanupBatchIds.push(emptyBatchId);

    const b3 = await pool.query(
      `insert into batches (centre_id, name, age_groups, day_of_week, start_time, end_time, capacity, status)
       values ($1, 'AT5 cancelled-only batch', array['bal']::age_group_enum[], array[0], '09:00', '11:00', 30, 'active')
       returning id`,
      [GHATKOPAR],
    );
    cancelledBatchId = b3.rows[0].id;
    cleanupBatchIds.push(cancelledBatchId);

    const b4 = await pool.query(
      `insert into batches (centre_id, name, age_groups, day_of_week, start_time, end_time, capacity, status)
       values ($1, 'AT5 holiday-marks batch', array['bal']::age_group_enum[], array[0], '09:00', '11:00', 30, 'active')
       returning id`,
      [GHATKOPAR],
    );
    holidayBatchId = b4.rows[0].id;
    cleanupBatchIds.push(holidayBatchId);

    const st = await pool.query(
      `insert into students (full_name, student_code, age_group, batch_id, centre_id, status)
       values ('AT5 Recon Child', $1, 'bal', $2, $3, 'active')
       returning id`,
      [`AT5-RECON-${randomUUID().slice(0, 8)}`, reconBatchId, GHATKOPAR],
    );
    reconStudentId = st.rows[0].id;
    cleanupStudentIds.push(reconStudentId);

    // Present before deactivation, absent after — rates diverge if post-deactivation rows leak.
    const sPre = await upsertSession(reconBatchId, `${RECON_MONTH}-05`, "completed");
    await mark(sPre, reconStudentId, "present", `${RECON_MONTH}-05`);

    await pool.query(
      `update students set deactivated_at = timestamptz '2023-05-10 06:00:00+05:30'
       where id = $1`,
      [reconStudentId],
    );

    const sPost = await upsertSession(reconBatchId, `${RECON_MONTH}-16`, "completed");
    await mark(sPost, reconStudentId, "absent", `${RECON_MONTH}-16`);

    // Homework: submitted before deactivation, pending after.
    const aPre = await pool.query(
      `insert into homework_assignments (batch_id, title, due_date)
       values ($1, 'AT5 hw pre', $2::date) returning id`,
      [reconBatchId, `${RECON_MONTH}-05`],
    );
    cleanupHwAssignmentIds.push(aPre.rows[0].id);
    const aPost = await pool.query(
      `insert into homework_assignments (batch_id, title, due_date)
       values ($1, 'AT5 hw post', $2::date) returning id`,
      [reconBatchId, `${RECON_MONTH}-16`],
    );
    cleanupHwAssignmentIds.push(aPost.rows[0].id);
    await pool.query(
      `insert into homework_submissions (assignment_id, student_id, status) values
         ($1, $3, 'submitted'),
         ($2, $3, 'pending')
       on conflict (assignment_id, student_id) do update set status = excluded.status`,
      [aPre.rows[0].id, aPost.rows[0].id, reconStudentId],
    );

    // Cancelled-only batch: attendance on a cancelled session must not become 0%.
    const sCan = await upsertSession(cancelledBatchId, `${RECON_MONTH}-12`, "cancelled");
    const stCan = await pool.query(
      `insert into students (full_name, student_code, age_group, batch_id, centre_id, status)
       values ('AT5 Cancelled Child', $1, 'bal', $2, $3, 'active') returning id`,
      [`AT5-CAN-${randomUUID().slice(0, 8)}`, cancelledBatchId, GHATKOPAR],
    );
    cleanupStudentIds.push(stCan.rows[0].id);
    await mark(sCan, stCan.rows[0].id, "present", `${RECON_MONTH}-12`);

    // AT10: holiday-dated session that already has attendance still counts (separate month
    // so RECON_MONTH centre rate stays equal to the single recon batch).
    const HOL_MONTH = "2023-06";
    const hol = await pool.query(
      `insert into centre_holidays (centre_id, holiday_date, reason, is_published)
       values ($1, $2::date, 'AT5 recon holiday', true) returning id`,
      [GHATKOPAR, `${HOL_MONTH}-20`],
    );
    cleanupHolidayIds.push(hol.rows[0].id);
    const stHol = await pool.query(
      `insert into students (full_name, student_code, age_group, batch_id, centre_id, status)
       values ('AT5 Holiday Child', $1, 'bal', $2, $3, 'active') returning id`,
      [`AT5-HOL-${randomUUID().slice(0, 8)}`, holidayBatchId, GHATKOPAR],
    );
    cleanupStudentIds.push(stHol.rows[0].id);
    const sHol = await upsertSession(holidayBatchId, `${HOL_MONTH}-20`, "completed");
    await mark(sHol, stHol.rows[0].id, "present", `${HOL_MONTH}-20`);
  });

  afterAll(async () => {
    if (cleanupHwAssignmentIds.length) {
      await pool.query(`delete from homework_submissions where assignment_id = any($1::uuid[])`, [
        cleanupHwAssignmentIds,
      ]);
      await pool.query(`delete from homework_assignments where id = any($1::uuid[])`, [
        cleanupHwAssignmentIds,
      ]);
    }
    if (cleanupAttIds.length) {
      await pool.query(`delete from attendance where id = any($1::uuid[])`, [cleanupAttIds]);
    }
    if (cleanupSessionIds.length) {
      await pool.query(`delete from sessions where id = any($1::uuid[])`, [cleanupSessionIds]);
    }
    if (cleanupHolidayIds.length) {
      await pool.query(`delete from centre_holidays where id = any($1::uuid[])`, [
        cleanupHolidayIds,
      ]);
    }
    if (cleanupStudentIds.length) {
      await pool.query(`delete from students where id = any($1::uuid[])`, [cleanupStudentIds]);
    }
    if (cleanupBatchIds.length) {
      await pool.query(`delete from batches where id = any($1::uuid[])`, [cleanupBatchIds]);
    }
  });

  it("per-batch attendance_rate equals AT5 centre rate when only one batch has marks (excludes post-deactivation)", async () => {
    // Post-deactivation absent must NOT be in the denominator.
    // Canonical → 1 present / 1 countable = 1.0. Broken LEFT JOIN → 1/2 = 0.5.
    const scalar = await pool.query(
      `select attendance_percentage_for_centres(array[$1]::uuid[], $2::date, $3::date) as rate`,
      [GHATKOPAR, FROM, TO],
    );
    const scalarRate = Number(scalar.rows[0].rate);
    expect(scalarRate).toBeCloseTo(1.0, 10);

    const snap = await composeCentreMonthlySnapshot(GHATKOPAR, RECON_MONTH);
    const batch = snap.batches.find((b) => b.batch_id === reconBatchId);
    expect(batch).toBeTruthy();
    expect(batch!.attendance_rate).toBeCloseTo(scalarRate, 10);
    expect(snap.attendance_rate).toBeCloseTo(scalarRate, 10);
  });

  it("per-batch homework_rate excludes submissions after deactivated_at (reconciles with centre helper)", async () => {
    // Canonical: only pre-deactivation submitted → 1/1 = 1.0. Broken: +pending → 1/2 = 0.5.
    const centreHw = await pool.query(
      `select homework_completion_rate_for_centres(array[$1]::uuid[], $2::date, $3::date) as rate`,
      [GHATKOPAR, FROM, TO],
    );
    const centreRate = Number(centreHw.rows[0].rate);
    expect(centreRate).toBeCloseTo(1.0, 10);

    const snap = await composeCentreMonthlySnapshot(GHATKOPAR, RECON_MONTH);
    const batch = snap.batches.find((b) => b.batch_id === reconBatchId);
    expect(batch!.homework_rate).toBeCloseTo(centreRate, 10);
    expect(snap.homework_rate).toBeCloseTo(centreRate, 10);
  });

  it("a batch with zero attendance rows still appears with a null rate", async () => {
    const snap = await composeCentreMonthlySnapshot(GHATKOPAR, RECON_MONTH);
    const batch = snap.batches.find((b) => b.batch_id === emptyBatchId);
    expect(batch).toBeTruthy();
    expect(batch!.attendance_rate).toBeNull();
    expect(batch!.homework_rate).toBeNull();
  });

  it("a batch whose only sessions are cancelled returns null, not 0", async () => {
    const snap = await composeCentreMonthlySnapshot(GHATKOPAR, RECON_MONTH);
    const batch = snap.batches.find((b) => b.batch_id === cancelledBatchId);
    expect(batch).toBeTruthy();
    expect(batch!.attendance_rate).toBeNull();
  });

  it("a holiday-dated session that already has attendance still counts (AT10)", async () => {
    const snap = await composeCentreMonthlySnapshot(GHATKOPAR, "2023-06");
    const batch = snap.batches.find((b) => b.batch_id === holidayBatchId);
    expect(batch).toBeTruthy();
    expect(batch!.attendance_rate).toBeCloseTo(1.0, 10);
  });
});
