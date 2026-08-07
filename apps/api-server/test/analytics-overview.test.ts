/**
 * GET /v1/admin/analytics/overview — scope integrity of the metric block.
 *
 * Every metric on this endpoint is centre-scoped except the donations sum:
 * `donations` carries no centre_id and no direct city_id, so the figure cannot
 * be narrowed to a sanchalak's centres. It is therefore withheld from roles
 * outside DONATION_VIEW_ROLES rather than returned as a national total, which
 * would leak past the city_admin gate the /admin/donations page draws.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import app from "../src/app";
import { pool } from "@workspace/db";
import { canViewDonations } from "@workspace/api-zod";
import { loginAs, auth, type SeedRole } from "./helpers";

afterAll(async () => {
  await pool.end();
});

async function overviewFor(role: SeedRole) {
  const session = await loginAs(role);
  const res = await request(app).get("/v1/admin/analytics/overview").set(auth(session.token));
  expect(res.status).toBe(200);
  return res.body.data as Record<string, unknown>;
}

describe("admin analytics overview — donation figure scoping", () => {
  it("omits donations_total_paise_ytd for a sanchalak", async () => {
    const data = await overviewFor("sanchalak");
    // The rest of the block still arrives — only the unscopable metric is withheld.
    expect(data.active_students).toBeTypeOf("number");
    expect(data.centres).toBeTypeOf("number");
    expect(data.pending_enrolments).toBeTypeOf("number");
    expect(data.open_service_requests).toBeTypeOf("number");
    expect("donations_total_paise_ytd" in data).toBe(false);
  });

  it("omits donations_total_paise_ytd for a shikshak", async () => {
    const data = await overviewFor("shikshak");
    expect("donations_total_paise_ytd" in data).toBe(false);
  });

  it("still returns donations_total_paise_ytd to a city_admin", async () => {
    const data = await overviewFor("city_admin");
    expect("donations_total_paise_ytd" in data).toBe(true);
    expect(data.donations_total_paise_ytd).toBeTypeOf("number");
    expect(data.donations_total_paise_ytd as number).toBeGreaterThanOrEqual(0);
  });

  it("canViewDonations is narrower than the admin panel roster", () => {
    expect(canViewDonations("super_admin")).toBe(true);
    expect(canViewDonations("state_admin")).toBe(true);
    expect(canViewDonations("city_admin")).toBe(true);
    expect(canViewDonations("sanchalak")).toBe(false);
    expect(canViewDonations("shikshak")).toBe(false);
    expect(canViewDonations(null)).toBe(false);
  });
});

describe("admin analytics overview — pending_enrolments vs open_service_requests", () => {
  let GHATKOPAR: string;
  let KOTHRUD: string;
  let BAL_BATCH: string;
  let KOTHRUD_BATCH: string;
  let PARENT_ID: string;

  const createdEnrolments: string[] = [];
  const createdStudents: string[] = [];
  const createdServiceRequests: string[] = [];

  beforeAll(async () => {
    GHATKOPAR = (
      await pool.query(`select id from centres where name = 'Ghatkopar Jain Pathshala'`)
    ).rows[0].id;
    KOTHRUD = (await pool.query(`select id from centres where name = 'Kothrud Jain Pathshala'`))
      .rows[0].id;
    BAL_BATCH = (
      await pool.query(
        `select id from batches where name = 'Bal Batch - Sunday Morning' and centre_id = $1`,
        [GHATKOPAR],
      )
    ).rows[0].id;
    KOTHRUD_BATCH = (
      await pool.query(
        `select id from batches where name = 'Tarun Batch - Saturday Evening' and centre_id = $1`,
        [KOTHRUD],
      )
    ).rows[0].id;
    PARENT_ID = (await pool.query(`select id from users where phone = '+919800000006'`)).rows[0]
      .id;
  });

  afterAll(async () => {
    if (createdServiceRequests.length) {
      await pool.query(`delete from service_requests where id = any($1::uuid[])`, [
        createdServiceRequests,
      ]);
    }
    if (createdEnrolments.length) {
      await pool.query(`delete from enrolments where id = any($1::uuid[])`, [createdEnrolments]);
    }
    if (createdStudents.length) {
      await pool.query(`delete from students where id = any($1::uuid[])`, [createdStudents]);
    }
  });

  it("pending_enrolments is centre-scoped and independent of open_service_requests", async () => {
    const before = await overviewFor("sanchalak");
    const beforePending = before.pending_enrolments as number;
    const beforeSr = before.open_service_requests as number;

    // In-scope pending enrolment (Ghatkopar).
    const stuIn = randomUUID();
    await pool.query(
      `insert into students (id, student_code, full_name, age_group, centre_id, batch_id, status)
       values ($1, $2, 'Overview Pending In', 'bal', $3, $4, 'active')`,
      [stuIn, `OV-IN-${stuIn.slice(0, 8)}`, GHATKOPAR, BAL_BATCH],
    );
    createdStudents.push(stuIn);
    const enIn = await pool.query(
      `insert into enrolments (student_id, requested_centre_id, requested_batch_id, status)
       values ($1, $2, $3, 'pending') returning id`,
      [stuIn, GHATKOPAR, BAL_BATCH],
    );
    createdEnrolments.push(enIn.rows[0].id);

    // Out-of-scope pending enrolment (Kothrud) — must not bump sanchalak pending_enrolments.
    const stuOut = randomUUID();
    await pool.query(
      `insert into students (id, student_code, full_name, age_group, centre_id, batch_id, status)
       values ($1, $2, 'Overview Pending Out', 'tarun', $3, $4, 'active')`,
      [stuOut, `OV-OUT-${stuOut.slice(0, 8)}`, KOTHRUD, KOTHRUD_BATCH],
    );
    createdStudents.push(stuOut);
    const enOut = await pool.query(
      `insert into enrolments (student_id, requested_centre_id, requested_batch_id, status)
       values ($1, $2, $3, 'pending') returning id`,
      [stuOut, KOTHRUD, KOTHRUD_BATCH],
    );
    createdEnrolments.push(enOut.rows[0].id);

    // Open unassigned service request in scope — must bump open_service_requests only.
    const sr = await pool.query(
      `insert into service_requests
         (parent_user_id, category, subject, description, status, centre_id)
       values ($1, 'general', $2, 'Overview SR independence check.', 'submitted', $3)
       returning id`,
      [PARENT_ID, `OV-SR-${Date.now()}`, GHATKOPAR],
    );
    createdServiceRequests.push(sr.rows[0].id);

    const after = await overviewFor("sanchalak");
    expect(after.pending_enrolments).toBe(beforePending + 1);
    expect(after.open_service_requests).toBe(beforeSr + 1);

    // Guard against conflation: clearing the SR must not move pending_enrolments.
    await pool.query(`update service_requests set status = 'resolved', resolved_at = now() where id = $1`, [
      sr.rows[0].id,
    ]);
    const afterResolve = await overviewFor("sanchalak");
    expect(afterResolve.open_service_requests).toBe(beforeSr);
    expect(afterResolve.pending_enrolments).toBe(beforePending + 1);
  });
});
