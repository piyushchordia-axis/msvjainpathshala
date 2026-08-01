import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

/**
 * Enrolments (Centre & Batch) — POST /v1/enrolments creation path.
 *
 * The seed has two cities: Mumbai (Ghatkopar centre, batches "Bal"/"Kishor") and
 * Pune (Kothrud centre, batch "Tarun"). The city_admin persona (+919800000003)
 * is scoped to Mumbai, so the Pune batch is out of its scope. The parent persona
 * owns Aarav + Diya (both in the Ghatkopar "Bal Batch").
 *
 * Capacity is computed from `students.batch_id` (active, non-deleted) attached to
 * the requested batch, so to exercise the capacity guard we stand up a private,
 * isolated centre+batch (capacity 1) in the admin's city, fill it with one active
 * student, then attempt one more auto-approve enrol. Everything we create gets a
 * unique id and is torn down in afterAll, keeping the suite additive/idempotent.
 */

// Seeded ids are resolved at runtime by natural key (name / student_code) in
// beforeAll — seed UUIDs are DB-generated (defaultRandom) and change every reseed,
// so hardcoding them is not stable. The logical entities themselves are stable.
let GHATKOPAR_CENTRE: string; // Mumbai, in city_admin scope
let KOTHRUD_CENTRE: string; // Pune, OUT of city_admin scope
let GHATKOPAR_STATE: string;
let GHATKOPAR_CITY: string;
let BAL_BATCH: string; // Ghatkopar, cap 25
let KISHOR_BATCH: string; // Ghatkopar, cap 30 (Aarav is NOT enrolled here)
let KOTHRUD_BATCH: string; // Kothrud, cap 20 (out of scope)
let AARAV: string; // owned by parent persona
let ANAYA: string; // Kothrud student (not owned by parent)

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

beforeAll(async () => {
  const centreByName = async (name: string) =>
    (await pool.query(`select id, state_id, city_id from centres where name = $1`, [name])).rows[0];
  const batchByName = async (name: string) =>
    (await pool.query(`select id from batches where name = $1`, [name])).rows[0].id as string;
  const studentByCode = async (code: string) =>
    (await pool.query(`select id from students where student_code = $1`, [code])).rows[0].id as string;

  const ghatkopar = await centreByName("Ghatkopar Jain Pathshala");
  GHATKOPAR_CENTRE = ghatkopar.id;
  GHATKOPAR_STATE = ghatkopar.state_id;
  GHATKOPAR_CITY = ghatkopar.city_id;
  KOTHRUD_CENTRE = (await centreByName("Kothrud Jain Pathshala")).id;
  BAL_BATCH = await batchByName("Bal Batch - Sunday Morning");
  KISHOR_BATCH = await batchByName("Kishor Batch - Sunday Morning");
  KOTHRUD_BATCH = await batchByName("Tarun Batch - Saturday Evening");
  AARAV = await studentByCode("STU000001"); // Aarav Shah, Ghatkopar, owned by parent
  ANAYA = await studentByCode("STU000004"); // Anaya Doshi, Kothrud, not owned by parent
});

// Track rows we create so we can tear them down precisely.
const createdEnrolments: string[] = [];
const createdStudents: string[] = [];
const createdBatches: string[] = [];
const createdCentres: string[] = [];

/** Insert an active, non-deleted student. Optionally attach to a batch/centre. */
async function makeStudent(opts: { centreId?: string | null; batchId?: string | null }): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into students (id, student_code, full_name, age_group, centre_id, batch_id, status)
     values ($1, $2, $3, 'bal', $4, $5, 'active')`,
    [id, `TST-${id.slice(0, 8)}`, `Test Student ${id.slice(0, 4)}`, opts.centreId ?? null, opts.batchId ?? null],
  );
  createdStudents.push(id);
  return id;
}

afterAll(async () => {
  // Tear down in FK-safe order. Enrolments first, then students, batches, centres.
  if (createdEnrolments.length) {
    await pool.query(`delete from enrolments where id = any($1::uuid[])`, [createdEnrolments]);
  }
  // Also clean any enrolments that point at students/batches we created.
  if (createdStudents.length) {
    await pool.query(`delete from enrolments where student_id = any($1::uuid[])`, [createdStudents]);
    await pool.query(`delete from students where id = any($1::uuid[])`, [createdStudents]);
  }
  if (createdBatches.length) {
    await pool.query(`delete from batches where id = any($1::uuid[])`, [createdBatches]);
  }
  if (createdCentres.length) {
    await pool.query(`delete from centres where id = any($1::uuid[])`, [createdCentres]);
  }
  await pool.end();
});

describe("enrolments — create", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .post("/v1/enrolments")
      .send({ student_id: AARAV, requested_batch_id: BAL_BATCH });
    expect(res.status).toBe(401);
  });

  it("lets an owner (parent) request an enrolment for their child -> pending", async () => {
    const { token } = await loginAs("parent");
    // Bal Batch (cap 25) — Aarav is already attached there, so use the Kishor
    // batch (Ghatkopar, cap 30) which Aarav is NOT enrolled into.
    // Clean any prior run's row so this is idempotent.
    await pool.query(
      `delete from enrolments where student_id = $1 and requested_batch_id = $2`,
      [AARAV, KISHOR_BATCH],
    );
    const res = await request(app)
      .post("/v1/enrolments")
      .set(auth(token))
      .send({ student_id: AARAV, requested_batch_id: KISHOR_BATCH, reason: "Please move him up." });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("pending");
    expect(res.body.data.id).toBeTruthy();
    createdEnrolments.push(res.body.data.id);
  });

  it("forbids an owner from using auto_approve (403)", async () => {
    const { token } = await loginAs("parent");
    const res = await request(app)
      .post("/v1/enrolments")
      .set(auth(token))
      .send({ student_id: AARAV, requested_batch_id: BAL_BATCH, auto_approve: true });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ERR_FORBIDDEN");
  });

  it("forbids an owner enrolling a student they do not own (404, no leak)", async () => {
    const { token } = await loginAs("parent");
    // Anaya is a real student in Pune, not owned by this parent.
    const res = await request(app)
      .post("/v1/enrolments")
      .set(auth(token))
      .send({ student_id: ANAYA, requested_batch_id: BAL_BATCH });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ERR_NOT_FOUND");
  });

  it("lets an in-scope admin enrol + auto-approve a student into their batch", async () => {
    const { token } = await loginAs("city_admin");
    // Fresh, in-scope, unattached student so capacity in Bal Batch (25) is fine.
    const studentId = await makeStudent({ centreId: GHATKOPAR_CENTRE, batchId: null });
    const res = await request(app)
      .post("/v1/enrolments")
      .set(auth(token))
      .send({ student_id: studentId, requested_batch_id: BAL_BATCH, auto_approve: true });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("approved");
    createdEnrolments.push(res.body.data.id);

    // The approval attached the student to the centre+batch.
    const { rows } = await pool.query(
      `select centre_id, batch_id, status from students where id = $1`,
      [studentId],
    );
    expect(rows[0].batch_id).toBe(BAL_BATCH);
    expect(rows[0].centre_id).toBe(GHATKOPAR_CENTRE);
    expect(rows[0].status).toBe("active");
  });

  it("rejects an enrolment from a non-admin-panel role with no owned student (404)", async () => {
    // The student persona is not an admin and does not own Anaya -> 404.
    const { token } = await loginAs("student");
    const res = await request(app)
      .post("/v1/enrolments")
      .set(auth(token))
      .send({ student_id: ANAYA, requested_batch_id: BAL_BATCH });
    expect(res.status).toBe(404);
  });
});

describe("enrolments — duplicate guard", () => {
  it("rejects a second live enrolment for the same (student, batch) with 409", async () => {
    const { token } = await loginAs("city_admin");
    const studentId = await makeStudent({ centreId: GHATKOPAR_CENTRE, batchId: null });

    // First pending request succeeds.
    const first = await request(app)
      .post("/v1/enrolments")
      .set(auth(token))
      .send({ student_id: studentId, requested_batch_id: BAL_BATCH });
    expect(first.status).toBe(201);
    expect(first.body.data.status).toBe("pending");
    createdEnrolments.push(first.body.data.id);

    // Second request for the same (student, batch) while the first is live -> 409.
    const second = await request(app)
      .post("/v1/enrolments")
      .set(auth(token))
      .send({ student_id: studentId, requested_batch_id: BAL_BATCH });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("ERR_ALREADY_ENROLLED");
  });
});

describe("enrolments — capacity guard", () => {
  it("rejects an auto-approve enrol beyond batch capacity with 409 ERR_BATCH_FULL", async () => {
    const { token } = await loginAs("city_admin");

    // Stand up a private, capacity-1 batch in the admin's city (Mumbai/Ghatkopar
    // city so it is in scope), already filled by one attached active student.
    const centreId = randomUUID();
    await pool.query(
      `insert into centres (id, state_id, city_id, name, status)
       values ($1, $2, $3, $4, 'active')`,
      [centreId, GHATKOPAR_STATE, GHATKOPAR_CITY, `Test Centre ${centreId.slice(0, 6)}`],
    );
    createdCentres.push(centreId);

    const batchId = randomUUID();
    await pool.query(
      `insert into batches (id, centre_id, name, age_groups, start_time, end_time, capacity, status)
       values ($1, $2, $3, ARRAY['bal']::age_group_enum[], '09:00', '10:00', 1, 'active')`,
      [batchId, centreId, `Test Batch ${batchId.slice(0, 6)}`],
    );
    createdBatches.push(batchId);

    // Fill the single seat with an attached, active student.
    await makeStudent({ centreId, batchId });

    // A second in-scope student requesting that batch with auto_approve -> full.
    const overflowStudent = await makeStudent({ centreId, batchId: null });
    const res = await request(app)
      .post("/v1/enrolments")
      .set(auth(token))
      .send({ student_id: overflowStudent, requested_batch_id: batchId, auto_approve: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ERR_BATCH_FULL");

    // A pending (non-seat-taking) request into the same full batch still succeeds,
    // since capacity is only enforced when a seat would be taken now.
    const pendingRes = await request(app)
      .post("/v1/enrolments")
      .set(auth(token))
      .send({ student_id: overflowStudent, requested_batch_id: batchId });
    expect(pendingRes.status).toBe(201);
    expect(pendingRes.body.data.status).toBe("pending");
    createdEnrolments.push(pendingRes.body.data.id);
  });
});

describe("enrolments — scope isolation", () => {
  it("hides an out-of-scope batch from a city_admin (404, treated as not found)", async () => {
    const { token } = await loginAs("city_admin"); // Mumbai scope
    const studentId = await makeStudent({ centreId: GHATKOPAR_CENTRE, batchId: null });
    // Kothrud batch is in Pune -> out of this admin's scope. Route returns 404 so
    // it does not leak the existence of the out-of-scope centre/batch.
    const res = await request(app)
      .post("/v1/enrolments")
      .set(auth(token))
      .send({ student_id: studentId, requested_batch_id: KOTHRUD_BATCH, auto_approve: true });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ERR_NOT_FOUND");
  });

  it("lets a super_admin enrol into any centre's batch", async () => {
    const { token } = await loginAs("super_admin"); // unscoped
    const studentId = await makeStudent({ centreId: KOTHRUD_CENTRE, batchId: null });
    const res = await request(app)
      .post("/v1/enrolments")
      .set(auth(token))
      .send({ student_id: studentId, requested_batch_id: KOTHRUD_BATCH });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("pending");
    createdEnrolments.push(res.body.data.id);
  });

  it("rejects an admin enrolling a student outside their scope (404)", async () => {
    const { token } = await loginAs("city_admin"); // Mumbai scope
    // Batch is in scope (Bal/Ghatkopar) but the student is attached to a Pune
    // centre -> out of scope -> 404 "Student not found in your scope."
    const res = await request(app)
      .post("/v1/enrolments")
      .set(auth(token))
      .send({ student_id: ANAYA, requested_batch_id: BAL_BATCH, auto_approve: true });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ERR_NOT_FOUND");
  });
});

describe("enrolments — validation", () => {
  it("rejects a missing student_id with 422", async () => {
    const { token } = await loginAs("city_admin");
    const res = await request(app)
      .post("/v1/enrolments")
      .set(auth(token))
      .send({ requested_batch_id: BAL_BATCH });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });

  it("rejects a non-uuid batch id with 422", async () => {
    const { token } = await loginAs("city_admin");
    const res = await request(app)
      .post("/v1/enrolments")
      .set(auth(token))
      .send({ student_id: AARAV, requested_batch_id: "not-a-uuid" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });

  it("rejects an over-long reason with 422", async () => {
    const { token } = await loginAs("city_admin");
    const res = await request(app)
      .post("/v1/enrolments")
      .set(auth(token))
      .send({ student_id: AARAV, requested_batch_id: BAL_BATCH, reason: "x".repeat(2001) });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });

  it("returns 404 for a well-formed but unknown batch id", async () => {
    const { token } = await loginAs("city_admin");
    const res = await request(app)
      .post("/v1/enrolments")
      .set(auth(token))
      .send({ student_id: AARAV, requested_batch_id: ZERO_UUID });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ERR_NOT_FOUND");
  });
});
