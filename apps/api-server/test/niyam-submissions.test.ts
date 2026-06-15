import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

/**
 * submission_date is bounded server-side to today or yesterday (IST). We use
 * today. To stay collision-proof against the seed AND across reruns (the DB is
 * not reset between test runs), each submit-based test creates its OWN fresh
 * niyam via POST /v1/admin/niyams — a brand-new niyam has no prior submissions,
 * so (student, freshNiyam, today) is always a free slot.
 */
function todayIst(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}
function tomorrowIst(): string {
  const d = new Date(`${todayIst()}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function daysAgoIst(n: number): string {
  const d = new Date(`${todayIst()}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Create a fresh niyam (proof_type 'either' so a proof submission goes pending). */
async function createNiyam(token: string, label: string): Promise<string> {
  const res = await request(app)
    .post("/v1/admin/niyams")
    .set(auth(token))
    .send({ title_en: `Test Niyam ${label}`, niyam_type: "daily", proof_type: "either", points: 10 });
  expect(res.status).toBe(200);
  return res.body.data.id as string;
}

async function firstChildId(parentToken: string, index = 0): Promise<string> {
  const children = await request(app).get("/v1/me/children").set(auth(parentToken));
  expect(children.status).toBe(200);
  const child = children.body.data.items[index];
  expect(child).toBeTruthy();
  return child.id as string;
}

describe("niyam-submissions", () => {
  it("requires auth on submit", async () => {
    const res = await request(app).post("/v1/niyam-submissions").send({});
    expect(res.status).toBe(401);
  });

  it("requires admin panel on pending list", async () => {
    const { token } = await loginAs("parent");
    const res = await request(app).get("/v1/niyam-submissions/pending").set(auth(token));
    expect(res.status).toBe(403);
  });

  it("submits with proof (pending) and a shikshak approves it, increasing points", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token, 0);
    const niyamId = await createNiyam(admin.token, "approve");
    const submissionDate = todayIst();

    const submit = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: studentId, submission_date: submissionDate, proof_url: "https://example.com/proof.jpg", notes: "Did my niyam today." });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe("pending");
    expect(submit.body.data.points_awarded).toBe(0);
    const submissionId: string = submit.body.data.id;

    // Duplicate same niyam+student+date -> 409.
    const dup = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: studentId, submission_date: submissionDate, proof_url: "https://example.com/proof2.jpg" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ERR_DUPLICATE");

    const before = await request(app).get(`/v1/me/students/${studentId}/punya`).set(auth(parent.token));
    const pointsBefore: number = before.body.data.total_points ?? 0;

    const shikshak = await loginAs("shikshak");
    const pending = await request(app).get("/v1/niyam-submissions/pending?limit=200").set(auth(shikshak.token));
    expect(pending.status).toBe(200);
    expect(pending.body.data.items.find((r: { id: string }) => r.id === submissionId)).toBeTruthy();

    const approve = await request(app).post(`/v1/niyam-submissions/${submissionId}/approve`).set(auth(shikshak.token)).send({});
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe("approved");
    expect(approve.body.data.total_points).toBeGreaterThan(pointsBefore);

    // Re-approve -> 409 via atomic compare-and-set.
    const reApprove = await request(app).post(`/v1/niyam-submissions/${submissionId}/approve`).set(auth(shikshak.token)).send({});
    expect(reApprove.status).toBe(409);
    expect(reApprove.body.error.code).toBe("ERR_INVALID_STATE");
  });

  it("rejects a pending submission with a reason", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token, 0);
    const niyamId = await createNiyam(admin.token, "reject");

    const submit = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: studentId, submission_date: todayIst(), proof_url: "https://example.com/proof-reject.jpg" });
    expect(submit.status).toBe(200);
    const submissionId: string = submit.body.data.id;

    const shikshak = await loginAs("shikshak");
    const reject = await request(app).post(`/v1/niyam-submissions/${submissionId}/reject`).set(auth(shikshak.token)).send({ reason: "Proof unclear." });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe("rejected");

    // Re-reject -> 409 via atomic compare-and-set.
    const reReject = await request(app).post(`/v1/niyam-submissions/${submissionId}/reject`).set(auth(shikshak.token)).send({ reason: "again" });
    expect(reReject.status).toBe(409);
    expect(reReject.body.error.code).toBe("ERR_INVALID_STATE");
  });

  // FIX #1: a rejected submission can be re-submitted for the same date.
  it("allows re-submitting after a rejection (rejected rows are ignored by the duplicate check)", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token, 1); // second child
    const niyamId = await createNiyam(admin.token, "resubmit");
    const submissionDate = todayIst();

    const first = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: studentId, submission_date: submissionDate, proof_url: "https://example.com/resubmit-1.jpg" });
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe("pending");
    const firstId: string = first.body.data.id;

    const shikshak = await loginAs("shikshak");
    const reject = await request(app).post(`/v1/niyam-submissions/${firstId}/reject`).set(auth(shikshak.token)).send({ reason: "Try again." });
    expect(reject.status).toBe(200);

    // Re-submit the SAME niyam+student+date -> SUCCEEDS (rejected rows ignored).
    const resubmit = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: studentId, submission_date: submissionDate, proof_url: "https://example.com/resubmit-2.jpg" });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.data.status).toBe("pending");
    expect(resubmit.body.data.id).not.toBe(firstId);

    // A SECOND resubmit (now a live pending row exists) is blocked.
    const blocked = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: studentId, submission_date: submissionDate, proof_url: "https://example.com/resubmit-3.jpg" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("ERR_DUPLICATE");
  });

  // FIX #2: a future submission_date is rejected server-side.
  it("rejects a future submission_date with 422", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token, 0);
    const niyamId = await createNiyam(admin.token, "future");

    const res = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: studentId, submission_date: tomorrowIst(), proof_url: "https://example.com/future.jpg" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
    expect(res.body.error.message).toMatch(/future/i);
  });

  // FIX #2: a too-old (older than yesterday) submission_date is rejected.
  it("rejects a too-old submission_date (older than yesterday) with 422", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token, 0);
    const niyamId = await createNiyam(admin.token, "old");

    const res = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: studentId, submission_date: daysAgoIst(5), proof_url: "https://example.com/old.jpg" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
    expect(res.body.error.message).toMatch(/too old/i);
  });
});
