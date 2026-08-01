import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth, type Session } from "./helpers";

afterAll(async () => {
  await pool.end();
});

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

const PROOF = "http://localhost:8080/uploads/niyam-proof/test-proof.jpg";
const BAD_PROOF = "http://localhost:8080/uploads/homework/not-allowed.jpg";

let admin: Session;
let parent: Session;
let shikshak: Session;
let child0: string;
let child1: string;

async function createNiyam(label: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await request(app)
    .post("/v1/admin/niyams")
    .set(auth(admin.token))
    .send({
      title_en: `Test Niyam ${label}`,
      niyam_type: "daily",
      proof_type: "either",
      approval_mode: "review",
      proof_required: false,
      max_uploads: 3,
      points: 10,
      ...extra,
    });
  expect([200, 201]).toContain(res.status);
  return res.body.data.id as string;
}

describe("niyam-submissions", () => {
  beforeAll(async () => {
    admin = await loginAs("super_admin");
    parent = await loginAs("parent");
    shikshak = await loginAs("shikshak");
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    expect(children.status).toBe(200);
    child0 = children.body.data.items[0].id;
    child1 = children.body.data.items[1].id;
  });

  it("requires auth on submit", async () => {
    const res = await request(app).post("/v1/niyam-submissions").send({});
    expect(res.status).toBe(401);
  });

  it("requires admin panel on pending list", async () => {
    const res = await request(app).get("/v1/niyam-submissions/pending").set(auth(parent.token));
    expect(res.status).toBe(403);
  });

  it("submits with proof (pending) and a shikshak approves it, increasing points", async () => {
    const niyamId = await createNiyam(`approve-${Date.now()}`);
    const submissionDate = todayIst();

    const submit = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({
        niyam_id: niyamId,
        student_id: child0,
        submission_date: submissionDate,
        proof_url: PROOF,
        notes: "Did my niyam today.",
      });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe("pending");
    expect(submit.body.data.points_awarded).toBe(0);
    const submissionId: string = submit.body.data.id;

    const dup = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child0, submission_date: submissionDate, proof_url: PROOF });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ERR_NIYAM_PERIOD_DUPLICATE");

    const before = await request(app).get(`/v1/me/students/${child0}/punya`).set(auth(parent.token));
    const pointsBefore: number = before.body.data.total_points ?? 0;

    const pending = await request(app).get("/v1/niyam-submissions/pending?limit=200").set(auth(shikshak.token));
    expect(pending.status).toBe(200);
    expect(pending.body.data.items.find((r: { id: string }) => r.id === submissionId)).toBeTruthy();

    const approve = await request(app).post(`/v1/niyam-submissions/${submissionId}/approve`).set(auth(shikshak.token)).send({});
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe("approved");
    expect(approve.body.data.total_points).toBeGreaterThan(pointsBefore);

    const reApprove = await request(app).post(`/v1/niyam-submissions/${submissionId}/approve`).set(auth(shikshak.token)).send({});
    expect(reApprove.status).toBe(409);
    expect(reApprove.body.error.code).toBe("ERR_INVALID_STATE");
  });

  it("rejects a pending submission with a reason", async () => {
    const niyamId = await createNiyam(`reject-${Date.now()}`);

    const submit = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child0, submission_date: todayIst(), proof_url: PROOF });
    expect(submit.status).toBe(200);
    const submissionId: string = submit.body.data.id;

    const reject = await request(app).post(`/v1/niyam-submissions/${submissionId}/reject`).set(auth(shikshak.token)).send({ reason: "Proof unclear." });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe("rejected");

    const reReject = await request(app).post(`/v1/niyam-submissions/${submissionId}/reject`).set(auth(shikshak.token)).send({ reason: "again" });
    expect(reReject.status).toBe(409);
    expect(reReject.body.error.code).toBe("ERR_INVALID_STATE");
  });

  it("allows re-submitting after a rejection (rejected rows are ignored by the duplicate check)", async () => {
    const niyamId = await createNiyam(`resubmit-${Date.now()}`);
    const submissionDate = todayIst();

    const first = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child1, submission_date: submissionDate, proof_url: PROOF });
    expect(first.status).toBe(200);
    const firstId: string = first.body.data.id;

    const reject = await request(app).post(`/v1/niyam-submissions/${firstId}/reject`).set(auth(shikshak.token)).send({ reason: "Try again." });
    expect(reject.status).toBe(200);

    const resubmit = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child1, submission_date: submissionDate, proof_url: PROOF });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.data.id).not.toBe(firstId);

    const blocked = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child1, submission_date: submissionDate, proof_url: PROOF });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("ERR_NIYAM_PERIOD_DUPLICATE");
  });

  it("rejects a future submission_date with 422", async () => {
    const niyamId = await createNiyam(`future-${Date.now()}`);

    const res = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child0, submission_date: tomorrowIst(), proof_url: PROOF });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
    expect(res.body.error.message).toMatch(/future/i);
  });

  it("rejects a too-old submission_date (older than yesterday) with 422", async () => {
    const niyamId = await createNiyam(`old-${Date.now()}`);

    const res = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child0, submission_date: daysAgoIst(5), proof_url: PROOF });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
    expect(res.body.error.message).toMatch(/too old/i);
  });

  it("blocks a second weekly submit in the same ISO week with ERR_NIYAM_PERIOD_DUPLICATE", async () => {
    const niyamId = await createNiyam(`weekly-${Date.now()}`, {
      niyam_type: "weekly",
      approval_mode: "auto",
    });

    const first = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child0, submission_date: todayIst() });
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe("auto_approved");

    const yesterday = daysAgoIst(1);
    const second = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child0, submission_date: yesterday });

    const periodKeyToday = first.body.data.period_key as string | undefined;
    if (second.status === 409) {
      expect(second.body.error.code).toBe("ERR_NIYAM_PERIOD_DUPLICATE");
    } else {
      expect(second.status).toBe(200);
      expect(second.body.data.period_key).not.toBe(periodKeyToday);
    }
  });

  it("monthly niyam allows only one non-rejected submit per calendar month", async () => {
    const niyamId = await createNiyam(`monthly-${Date.now()}`, {
      niyam_type: "monthly",
      approval_mode: "auto",
    });

    const first = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child0, submission_date: todayIst() });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child0, submission_date: daysAgoIst(1) });
    if (second.status === 409) {
      expect(second.body.error.code).toBe("ERR_NIYAM_PERIOD_DUPLICATE");
    } else {
      expect(second.status).toBe(200);
      expect(second.body.data.period_key).not.toBe(first.body.data.period_key);
    }
  });

  it("approval_mode review awards zero points; auto awards immediately", async () => {
    const reviewId = await createNiyam(`mode-review-${Date.now()}`, { approval_mode: "review" });
    const autoId = await createNiyam(`mode-auto-${Date.now()}`, { approval_mode: "auto" });

    const before = await request(app).get(`/v1/me/students/${child0}/punya`).set(auth(parent.token));
    const pointsBefore: number = before.body.data.total_points ?? 0;

    const review = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: reviewId, student_id: child0, submission_date: todayIst() });
    expect(review.status).toBe(200);
    expect(review.body.data.status).toBe("pending");
    expect(review.body.data.points_awarded).toBe(0);

    const auto = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: autoId, student_id: child0, submission_date: todayIst() });
    expect(auto.status).toBe(200);
    expect(auto.body.data.status).toBe("auto_approved");
    expect(auto.body.data.points_awarded).toBe(10);

    const after = await request(app).get(`/v1/me/students/${child0}/punya`).set(auth(parent.token));
    expect(after.body.data.total_points).toBe(pointsBefore + 10);
  });

  it("rejecting auto_approved reverses punya exactly once", async () => {
    const niyamId = await createNiyam(`reverse-${Date.now()}`, { approval_mode: "auto", points: 12 });

    const before = await request(app).get(`/v1/me/students/${child0}/punya`).set(auth(parent.token));
    const pointsBefore: number = before.body.data.total_points ?? 0;

    const submit = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child0, submission_date: todayIst() });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe("auto_approved");
    const submissionId: string = submit.body.data.id;

    const mid = await request(app).get(`/v1/me/students/${child0}/punya`).set(auth(parent.token));
    expect(mid.body.data.total_points).toBe(pointsBefore + 12);

    const reject = await request(app)
      .post(`/v1/niyam-submissions/${submissionId}/reject`)
      .set(auth(shikshak.token))
      .send({ reason: "Retroactive reject" });
    expect(reject.status).toBe(200);
    expect(reject.body.data.points_reversed).toBe(12);

    const after = await request(app).get(`/v1/me/students/${child0}/punya`).set(auth(parent.token));
    expect(after.body.data.total_points).toBe(pointsBefore);

    const reReject = await request(app)
      .post(`/v1/niyam-submissions/${submissionId}/reject`)
      .set(auth(shikshak.token))
      .send({ reason: "again" });
    expect(reReject.status).toBe(409);

    const final = await request(app).get(`/v1/me/students/${child0}/punya`).set(auth(parent.token));
    expect(final.body.data.total_points).toBe(pointsBefore);
  });

  it("rejects media over max_uploads, wrong kind, and non-niyam-proof urls", async () => {
    const capped = await createNiyam(`cap-${Date.now()}`, {
      approval_mode: "auto",
      max_uploads: 1,
      proof_type: "photo",
      proof_required: false,
    });
    const over = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({
        niyam_id: capped,
        student_id: child0,
        submission_date: todayIst(),
        media: [
          { url: PROOF, kind: "photo" },
          { url: "http://localhost:8080/uploads/niyam-proof/two.jpg", kind: "photo" },
        ],
      });
    expect(over.status).toBe(422);

    const photoOnly = await createNiyam(`kind-${Date.now()}`, {
      approval_mode: "auto",
      proof_type: "photo",
      max_uploads: 2,
    });
    const wrongKind = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({
        niyam_id: photoOnly,
        student_id: child0,
        submission_date: todayIst(),
        media: [{ url: "http://localhost:8080/uploads/niyam-proof/clip.mp4", kind: "video" }],
      });
    expect(wrongKind.status).toBe(422);

    const anyUrl = await createNiyam(`url-${Date.now()}`, { approval_mode: "auto" });
    const badUrl = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({
        niyam_id: anyUrl,
        student_id: child0,
        submission_date: todayIst(),
        media: [{ url: BAD_PROOF, kind: "photo" }],
      });
    expect(badUrl.status).toBe(422);
    expect(badUrl.body.error.message).toMatch(/niyam-proof/i);
  });

  it("two concurrent submits in the same period produce one winner", async () => {
    const niyamId = await createNiyam(`concurrent-${Date.now()}`, { approval_mode: "auto" });

    const [a, b] = await Promise.all([
      request(app)
        .post("/v1/niyam-submissions")
        .set(auth(parent.token))
        .send({ niyam_id: niyamId, student_id: child0, submission_date: todayIst() }),
      request(app)
        .post("/v1/niyam-submissions")
        .set(auth(parent.token))
        .send({ niyam_id: niyamId, student_id: child0, submission_date: todayIst() }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const okRes = a.status === 200 ? a : b;
    expect(okRes.body.data.points_awarded).toBe(10);
  });
});
