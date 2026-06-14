import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

/**
 * MSV programme workflow: a parent applies for their child, a duplicate apply is
 * rejected, a city_admin sees the application in scope and approves it.
 *
 * Self-creating + rerun-safe: we resolve the parent's first child via
 * GET /v1/me/children (the parent owns "Aarav Shah") and reset that student's
 * MSV state (students.msv_status -> 'none', delete prior enrolments) before the
 * flow, so re-running against a non-reset DB always starts clean.
 */
let parentToken = "";
let cityAdminToken = "";
let studentId = "";

beforeAll(async () => {
  const parent = await loginAs("parent");
  parentToken = parent.token;
  const cityAdmin = await loginAs("city_admin");
  cityAdminToken = cityAdmin.token;

  const children = await request(app).get("/v1/me/children").set(auth(parentToken));
  expect(children.status).toBe(200);
  const aarav = (children.body.data.items as Array<{ id: string; full_name: string }>).find(
    (c) => c.full_name === "Aarav Shah",
  );
  expect(aarav).toBeTruthy();
  studentId = aarav!.id;

  // Reset prior state so the flow is rerun-safe against a non-reset DB.
  await pool.query("delete from msv_enrolments where student_id = $1", [studentId]);
  await pool.query("update students set msv_status = 'none' where id = $1", [studentId]);
});

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

describe("msv workflow", () => {
  it("rejects unauthenticated apply", async () => {
    const res = await request(app).post("/v1/msv/apply").send({ student_id: studentId });
    expect(res.status).toBe(401);
  });

  it("rejects applying for a student the caller does not own", async () => {
    const res = await request(app)
      .post("/v1/msv/apply")
      .set(auth(parentToken))
      .send({ student_id: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(404);
  });

  let enrolmentId = "";

  it("lets the parent apply for their child -> status applied", async () => {
    const res = await request(app)
      .post("/v1/msv/apply")
      .set(auth(parentToken))
      .send({ student_id: studentId });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("applied");
    expect(typeof res.body.data.id).toBe("string");
    enrolmentId = res.body.data.id;

    // students.msv_status now reflects the application.
    const children = await request(app).get("/v1/me/children").set(auth(parentToken));
    const aarav = (children.body.data.items as Array<{ id: string; msv_status: string }>).find(
      (c) => c.id === studentId,
    );
    expect(aarav?.msv_status).toBe("applied");

    // /msv/mine surfaces the latest enrolment.
    const mine = await request(app).get("/v1/msv/mine").set(auth(parentToken));
    expect(mine.status).toBe(200);
    const row = (mine.body.data.items as Array<{ id: string; msv_status: string; latest_enrolment: { id: string; status: string } | null }>).find(
      (r) => r.id === studentId,
    );
    expect(row?.msv_status).toBe("applied");
    expect(row?.latest_enrolment?.id).toBe(enrolmentId);
    expect(row?.latest_enrolment?.status).toBe("applied");
  });

  it("rejects a duplicate apply with 409", async () => {
    const res = await request(app)
      .post("/v1/msv/apply")
      .set(auth(parentToken))
      .send({ student_id: studentId });
    expect(res.status).toBe(409);
  });

  it("forbids the admin list for a non-admin caller", async () => {
    const res = await request(app).get("/v1/msv?limit=100").set(auth(parentToken));
    expect(res.status).toBe(403);
  });

  it("lets the city_admin see the application in scope", async () => {
    const res = await request(app).get("/v1/msv?limit=100").set(auth(cityAdminToken));
    expect(res.status).toBe(200);
    const found = (res.body.data.items as Array<{ id: string; student_id: string; status: string }>).find(
      (r) => r.id === enrolmentId,
    );
    expect(found).toBeTruthy();
    expect(found?.student_id).toBe(studentId);
    expect(found?.status).toBe("applied");
  });

  it("filters the admin list by status", async () => {
    const res = await request(app).get("/v1/msv?status=applied&limit=100").set(auth(cityAdminToken));
    expect(res.status).toBe(200);
    const statuses = (res.body.data.items as Array<{ status: string }>).map((r) => r.status);
    expect(statuses.every((s) => s === "applied")).toBe(true);
    expect((res.body.data.items as Array<{ id: string }>).some((r) => r.id === enrolmentId)).toBe(true);
  });

  it("lets the city_admin approve -> status approved", async () => {
    const res = await request(app)
      .post(`/v1/msv/${enrolmentId}/approve`)
      .set(auth(cityAdminToken))
      .send({ note: "Verified attendance and conduct." });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(enrolmentId);
    expect(res.body.data.status).toBe("approved");

    // student.msv_status mirrors the decision.
    const children = await request(app).get("/v1/me/children").set(auth(parentToken));
    const aarav = (children.body.data.items as Array<{ id: string; msv_status: string }>).find(
      (c) => c.id === studentId,
    );
    expect(aarav?.msv_status).toBe("approved");
  });

  it("rejects re-approving an already-approved enrolment with 409 and keeps msv_status", async () => {
    // The enrolment was approved by the prior test; re-deciding must be refused.
    const res = await request(app)
      .post(`/v1/msv/${enrolmentId}/approve`)
      .set(auth(cityAdminToken))
      .send({ note: "Trying to approve again." });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ERR_INVALID_STATE");

    // student.msv_status is unchanged (still approved, not desynced).
    const children = await request(app).get("/v1/me/children").set(auth(parentToken));
    const aarav = (children.body.data.items as Array<{ id: string; msv_status: string }>).find(
      (c) => c.id === studentId,
    );
    expect(aarav?.msv_status).toBe("approved");
  });

  it("rejects rejecting an already-approved enrolment with 409", async () => {
    const res = await request(app)
      .post(`/v1/msv/${enrolmentId}/reject`)
      .set(auth(cityAdminToken))
      .send({ reason: "Trying to flip an approved decision." });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ERR_INVALID_STATE");

    // student.msv_status is unchanged.
    const children = await request(app).get("/v1/me/children").set(auth(parentToken));
    const aarav = (children.body.data.items as Array<{ id: string; msv_status: string }>).find(
      (c) => c.id === studentId,
    );
    expect(aarav?.msv_status).toBe("approved");
  });

  it("returns 404 approving an out-of-scope or missing enrolment", async () => {
    const res = await request(app)
      .post(`/v1/msv/00000000-0000-0000-0000-000000000000/approve`)
      .set(auth(cityAdminToken))
      .send({});
    expect(res.status).toBe(404);
  });
});
