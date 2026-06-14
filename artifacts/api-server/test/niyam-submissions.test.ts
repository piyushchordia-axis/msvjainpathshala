import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

// A distinct date per run avoids colliding with seeded/previous submissions.
function uniqueDate(): string {
  // Spread across a wide past window deterministically per run.
  const offset = 200 + Math.floor(Math.random() * 3000);
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
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
    const parent = await loginAs("parent");

    // Find one of the parent's children.
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    expect(children.status).toBe(200);
    const child = children.body.data.items[0];
    expect(child).toBeTruthy();
    const studentId: string = child.id;

    // Pick an active niyam from the catalog.
    const catalog = await request(app).get("/v1/me/niyam-catalog").set(auth(parent.token));
    expect(catalog.status).toBe(200);
    const niyam = catalog.body.data.items[0];
    expect(niyam).toBeTruthy();
    const niyamId: string = niyam.id;

    const submissionDate = uniqueDate();

    // Submit WITH proof_url -> pending (awaits review).
    const submit = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({
        niyam_id: niyamId,
        student_id: studentId,
        submission_date: submissionDate,
        proof_url: "https://example.com/proof.jpg",
        notes: "Did my niyam today.",
      });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe("pending");
    expect(submit.body.data.points_awarded).toBe(0);
    const submissionId: string = submit.body.data.id;

    // Duplicate same niyam+student+date -> 409.
    const dup = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({
        niyam_id: niyamId,
        student_id: studentId,
        submission_date: submissionDate,
        proof_url: "https://example.com/proof2.jpg",
      });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ERR_DUPLICATE");

    // Read the child's current points before approval.
    const before = await request(app)
      .get(`/v1/me/students/${studentId}/punya`)
      .set(auth(parent.token));
    expect(before.status).toBe(200);
    const pointsBefore: number = before.body.data.total_points ?? 0;

    // Shikshak sees the pending submission and approves it.
    const shikshak = await loginAs("shikshak");
    const pending = await request(app)
      .get("/v1/niyam-submissions/pending?limit=100")
      .set(auth(shikshak.token));
    expect(pending.status).toBe(200);
    const mine = pending.body.data.items.find((r: { id: string }) => r.id === submissionId);
    expect(mine).toBeTruthy();

    const approve = await request(app)
      .post(`/v1/niyam-submissions/${submissionId}/approve`)
      .set(auth(shikshak.token))
      .send({});
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe("approved");
    expect(approve.body.data.total_points).toBeGreaterThan(pointsBefore);

    // Approving again -> 409 (no longer pending).
    const reApprove = await request(app)
      .post(`/v1/niyam-submissions/${submissionId}/approve`)
      .set(auth(shikshak.token))
      .send({});
    expect(reApprove.status).toBe(409);
  });

  it("rejects a pending submission with a reason", async () => {
    const parent = await loginAs("parent");

    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    const studentId: string = children.body.data.items[0].id;
    const catalog = await request(app).get("/v1/me/niyam-catalog").set(auth(parent.token));
    const niyamId: string = catalog.body.data.items[0].id;
    const submissionDate = uniqueDate();

    const submit = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({
        niyam_id: niyamId,
        student_id: studentId,
        submission_date: submissionDate,
        proof_url: "https://example.com/proof-reject.jpg",
      });
    expect(submit.status).toBe(200);
    const submissionId: string = submit.body.data.id;

    const shikshak = await loginAs("shikshak");
    const reject = await request(app)
      .post(`/v1/niyam-submissions/${submissionId}/reject`)
      .set(auth(shikshak.token))
      .send({ reason: "Proof unclear." });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe("rejected");
  });
});
