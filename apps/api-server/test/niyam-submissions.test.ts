import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import app from "../src/app";
import {
  pool,
  db,
  niyam_submissions,
  niyam_streaks,
  niyam_badges,
  gallery_items,
  notifications,
  punya_transactions,
  users,
  students,
  device_push_tokens,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { loginAs, auth, type Session } from "./helpers";
import {
  resetMemoryRateLimitsForTests,
  clearMemoryRateLimitKeyForTests,
} from "../src/lib/ratelimit";
import { periodKey } from "../src/lib/niyam-period";
import { recomputeStreak, runNiyamStreakLapse } from "../src/routes/v1/niyam-submissions";
import * as pushModule from "../src/lib/push";

/** Valid reject reason (≥20 chars) used across N2a reject tests. */
const REJECT_REASON =
  "Proof is unclear; please resubmit with a clearer photo.";

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
      // Open window so tests can seed / submit yesterday and older period keys.
      start_date: daysAgoIst(60),
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

    const reject = await request(app)
      .post(`/v1/niyam-submissions/${submissionId}/reject`)
      .set(auth(shikshak.token))
      .send({ reason: REJECT_REASON });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe("rejected");

    const reReject = await request(app)
      .post(`/v1/niyam-submissions/${submissionId}/reject`)
      .set(auth(shikshak.token))
      .send({ reason: REJECT_REASON });
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

    const reject = await request(app)
      .post(`/v1/niyam-submissions/${firstId}/reject`)
      .set(auth(shikshak.token))
      .send({ reason: REJECT_REASON });
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
      .send({ reason: REJECT_REASON });
    expect(reject.status).toBe(200);
    expect(reject.body.data.points_reversed).toBe(12);

    const after = await request(app).get(`/v1/me/students/${child0}/punya`).set(auth(parent.token));
    expect(after.body.data.total_points).toBe(pointsBefore);

    const reReject = await request(app)
      .post(`/v1/niyam-submissions/${submissionId}/reject`)
      .set(auth(shikshak.token))
      .send({ reason: REJECT_REASON });
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

  it("reject at 29 days reverses punya; at 31 days returns ERR_NIYAM_REVERSAL_WINDOW_EXPIRED", async () => {
    const niyam29 = await createNiyam(`win29-${Date.now()}`, { approval_mode: "auto", points: 7 });
    const before = await request(app).get(`/v1/me/students/${child0}/punya`).set(auth(parent.token));
    const pointsBefore: number = before.body.data.total_points ?? 0;

    const submit29 = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyam29, student_id: child0, submission_date: todayIst(), proof_url: PROOF });
    expect(submit29.status).toBe(200);
    const id29: string = submit29.body.data.id;
    expect(submit29.body.data.can_reject).toBe(true);

    await db
      .update(niyam_submissions)
      .set({ created_at: sql`now() - interval '29 days'` })
      .where(eq(niyam_submissions.id, id29));

    const reject29 = await request(app)
      .post(`/v1/niyam-submissions/${id29}/reject`)
      .set(auth(shikshak.token))
      .send({ reason: REJECT_REASON });
    expect(reject29.status).toBe(200);
    expect(reject29.body.data.points_reversed).toBe(7);

    const after29 = await request(app).get(`/v1/me/students/${child0}/punya`).set(auth(parent.token));
    expect(after29.body.data.total_points).toBe(pointsBefore);

    const niyam31 = await createNiyam(`win31-${Date.now()}`, { approval_mode: "auto", points: 8 });
    const before31 = await request(app).get(`/v1/me/students/${child0}/punya`).set(auth(parent.token));
    const pointsBefore31: number = before31.body.data.total_points ?? 0;

    const submit31 = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyam31, student_id: child0, submission_date: todayIst(), proof_url: PROOF });
    expect(submit31.status).toBe(200);
    const id31: string = submit31.body.data.id;

    const mid31 = await request(app).get(`/v1/me/students/${child0}/punya`).set(auth(parent.token));
    expect(mid31.body.data.total_points).toBe(pointsBefore31 + 8);

    await db
      .update(niyam_submissions)
      .set({ created_at: sql`now() - interval '31 days'` })
      .where(eq(niyam_submissions.id, id31));

    const reject31 = await request(app)
      .post(`/v1/niyam-submissions/${id31}/reject`)
      .set(auth(shikshak.token))
      .send({ reason: REJECT_REASON });
    expect(reject31.status).toBe(409);
    expect(reject31.body.error.code).toBe("ERR_NIYAM_REVERSAL_WINDOW_EXPIRED");

    const after31 = await request(app).get(`/v1/me/students/${child0}/punya`).set(auth(parent.token));
    expect(after31.body.data.total_points).toBe(mid31.body.data.total_points);
  });

  it("reject a still-pending 60-day-old submission succeeds (window does not apply)", async () => {
    const niyamId = await createNiyam(`pending60-${Date.now()}`, { approval_mode: "review" });
    const submit = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({
        niyam_id: niyamId,
        student_id: child0,
        submission_date: todayIst(),
        proof_url: PROOF,
        notes: "parent note must stay intact",
      });
    expect(submit.status).toBe(200);
    const submissionId: string = submit.body.data.id;

    await db
      .update(niyam_submissions)
      .set({ created_at: sql`now() - interval '60 days'` })
      .where(eq(niyam_submissions.id, submissionId));

    const reject = await request(app)
      .post(`/v1/niyam-submissions/${submissionId}/reject`)
      .set(auth(shikshak.token))
      .send({ reason: REJECT_REASON });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe("rejected");
  });

  it("reject with a 5-char reason returns 422 and leaves notes byte-identical", async () => {
    const niyamId = await createNiyam(`short-reason-${Date.now()}`, { approval_mode: "review" });
    const notes = "Keep this parent note exactly as written.";
    const submit = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({
        niyam_id: niyamId,
        student_id: child0,
        submission_date: todayIst(),
        proof_url: PROOF,
        notes,
      });
    expect(submit.status).toBe(200);
    const submissionId: string = submit.body.data.id;

    const reject = await request(app)
      .post(`/v1/niyam-submissions/${submissionId}/reject`)
      .set(auth(shikshak.token))
      .send({ reason: "short" });
    expect(reject.status).toBe(422);

    const [row] = await db
      .select({ notes: niyam_submissions.notes, status: niyam_submissions.status })
      .from(niyam_submissions)
      .where(eq(niyam_submissions.id, submissionId))
      .limit(1);
    expect(row.notes).toBe(notes);
    expect(row.status).toBe("pending");
  });

  it("reject inserts a niyam_rejected notification for the parent", async () => {
    const niyamId = await createNiyam(`notify-${Date.now()}`, { approval_mode: "review" });
    const submit = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child0, submission_date: todayIst(), proof_url: PROOF });
    expect(submit.status).toBe(200);
    const submissionId: string = submit.body.data.id;

    const reject = await request(app)
      .post(`/v1/niyam-submissions/${submissionId}/reject`)
      .set(auth(shikshak.token))
      .send({ reason: REJECT_REASON });
    expect(reject.status).toBe(200);

    const [note] = await db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        body_en: notifications.body_en,
      })
      .from(notifications)
      .where(
        and(eq(notifications.user_id, parent.user.id), eq(notifications.kind, "niyam_rejected")),
      )
      .orderBy(desc(notifications.created_at))
      .limit(1);
    expect(note).toBeTruthy();
    expect(note.body_en).toContain(REJECT_REASON);

    const [subRow] = await db
      .select({
        rejection_reason: niyam_submissions.rejection_reason,
        rejected_at: niyam_submissions.rejected_at,
        notes: niyam_submissions.notes,
      })
      .from(niyam_submissions)
      .where(eq(niyam_submissions.id, submissionId))
      .limit(1);
    expect(subRow.rejection_reason).toBe(REJECT_REASON);
    expect(subRow.rejected_at).toBeTruthy();
  });

  it("auto-approved photo submission creates exactly one gallery_items row; invisible until opt-in", async () => {
    const niyamId = await createNiyam(`gallery-${Date.now()}`, {
      approval_mode: "auto",
      proof_type: "photo",
      max_uploads: 2,
    });

    const [owner] = await db
      .select({ id: users.id, optIn: users.gallery_visibility_opt_in })
      .from(students)
      .innerJoin(users, eq(users.id, students.parent_id))
      .where(eq(students.id, child0))
      .limit(1);
    expect(owner).toBeTruthy();
    const seededOptIn = owner.optIn;

    try {
      await db
        .update(users)
        .set({ gallery_visibility_opt_in: false })
        .where(eq(users.id, owner.id));

      const submit = await request(app)
        .post("/v1/niyam-submissions")
        .set(auth(parent.token))
        .send({
          niyam_id: niyamId,
          student_id: child0,
          submission_date: todayIst(),
          media: [{ url: PROOF, kind: "photo" }],
        });
      expect(submit.status).toBe(200);
      expect(submit.body.data.status).toBe("auto_approved");
      const submissionId: string = submit.body.data.id;

      const galleryRows = await db
        .select({ id: gallery_items.id, submission_id: gallery_items.submission_id })
        .from(gallery_items)
        .where(eq(gallery_items.submission_id, submissionId));
      expect(galleryRows).toHaveLength(1);
      expect(galleryRows[0]!.submission_id).toBe(submissionId);

      const feedOff = await request(app).get("/v1/gallery?limit=200");
      expect(feedOff.status).toBe(200);
      const whenOff = feedOff.body.data.items.find(
        (r: { id: string }) => r.id === galleryRows[0]!.id,
      );
      expect(whenOff).toBeUndefined();

      await db
        .update(users)
        .set({ gallery_visibility_opt_in: true })
        .where(eq(users.id, owner.id));

      const feedOn = await request(app).get("/v1/gallery?limit=200");
      expect(feedOn.status).toBe(200);
      const whenOn = feedOn.body.data.items.find(
        (r: { id: string }) => r.id === galleryRows[0]!.id,
      );
      expect(whenOn).toBeTruthy();
    } finally {
      await db
        .update(users)
        .set({ gallery_visibility_opt_in: seededOptIn })
        .where(eq(users.id, owner.id));
    }
  });

  it("auto-approve awards punya inside the same transaction (ledger always present with points)", async () => {
    const niyamId = await createNiyam(`tx-award-${Date.now()}`, { approval_mode: "auto", points: 11 });
    const submit = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child0, submission_date: todayIst() });
    expect(submit.status).toBe(200);
    expect(submit.body.data.points_awarded).toBe(11);
    const submissionId: string = submit.body.data.id;

    const [sub] = await db
      .select({
        points_awarded: niyam_submissions.points_awarded,
        punya_transaction_id: niyam_submissions.punya_transaction_id,
        approved_at: niyam_submissions.approved_at,
      })
      .from(niyam_submissions)
      .where(eq(niyam_submissions.id, submissionId))
      .limit(1);
    expect(sub.points_awarded).toBe(11);
    expect(sub.punya_transaction_id).toBeTruthy();
    expect(sub.approved_at).toBeTruthy();

    const [ledger] = await db
      .select({
        id: punya_transactions.id,
        points: punya_transactions.points,
        idempotency_key: punya_transactions.idempotency_key,
      })
      .from(punya_transactions)
      .where(eq(punya_transactions.idempotency_key, `submission:${submissionId}`))
      .limit(1);
    expect(ledger).toBeTruthy();
    expect(ledger.points).toBe(11);
    expect(ledger.id).toBe(sub.punya_transaction_id);
  });

  it("awards daily_7 exactly once across day 7 and day 8", async () => {
    const niyamId = await createNiyam(`badge7-${Date.now()}`, { approval_mode: "auto", points: 5 });
    // Seed days -7..-2 (6 days); yesterday API submit → streak 7; today → streak 8.
    for (let i = 7; i >= 2; i--) {
      const d = daysAgoIst(i);
      await db.insert(niyam_submissions).values({
        niyam_id: niyamId,
        student_id: child0,
        submission_date: d,
        period_key: periodKey("daily", d),
        status: "auto_approved",
        points_awarded: 5,
        submitted_by: parent.user.id,
      });
    }

    const day7 = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child0, submission_date: daysAgoIst(1) });
    expect(day7.status).toBe(200);
    expect(day7.body.data.new_badges?.some((b: { badge_key: string }) => b.badge_key === "daily_7")).toBe(
      true,
    );

    const badgesAfter7 = await db
      .select()
      .from(niyam_badges)
      .where(
        and(
          eq(niyam_badges.student_id, child0),
          eq(niyam_badges.niyam_id, niyamId),
          eq(niyam_badges.badge_key, "daily_7"),
        ),
      );
    expect(badgesAfter7).toHaveLength(1);

    const day8 = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child0, submission_date: todayIst() });
    expect(day8.status).toBe(200);
    expect(day8.body.data.new_badges?.some((b: { badge_key: string }) => b.badge_key === "daily_7")).toBe(
      false,
    );

    const badgesAfter8 = await db
      .select()
      .from(niyam_badges)
      .where(
        and(
          eq(niyam_badges.student_id, child0),
          eq(niyam_badges.niyam_id, niyamId),
          eq(niyam_badges.badge_key, "daily_7"),
        ),
      );
    expect(badgesAfter8).toHaveLength(1);
  });

  it("rejecting mid-streak drops current_streak but keeps daily_7 and longest_streak", async () => {
    const niyamId = await createNiyam(`badge-keep-${Date.now()}`, { approval_mode: "auto", points: 4 });
    const ids: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = daysAgoIst(i);
      const [row] = await db
        .insert(niyam_submissions)
        .values({
          niyam_id: niyamId,
          student_id: child1,
          submission_date: d,
          period_key: periodKey("daily", d),
          status: "auto_approved",
          points_awarded: 4,
          submitted_by: parent.user.id,
        })
        .returning({ id: niyam_submissions.id });
      ids.push(row.id);
    }
    await db.insert(niyam_streaks).values({
      student_id: child1,
      niyam_id: niyamId,
      current_streak: 7,
      longest_streak: 7,
      last_submission_date: todayIst(),
      last_period_key: periodKey("daily", todayIst()),
    });
    await db.insert(niyam_badges).values({
      student_id: child1,
      niyam_id: niyamId,
      badge_key: "daily_7",
      streak_length: 7,
      points_awarded: 25,
    });

    // Reject day 4 of the streak (index 3 from oldest = daysAgo(3)).
    const midId = ids[3]!;
    const reject = await request(app)
      .post(`/v1/niyam-submissions/${midId}/reject`)
      .set(auth(shikshak.token))
      .send({ reason: REJECT_REASON });
    expect(reject.status).toBe(200);

    const [streak] = await db
      .select()
      .from(niyam_streaks)
      .where(and(eq(niyam_streaks.student_id, child1), eq(niyam_streaks.niyam_id, niyamId)))
      .limit(1);
    expect(streak.current_streak).toBeLessThan(7);
    expect(streak.longest_streak).toBe(7);

    const badges = await db
      .select()
      .from(niyam_badges)
      .where(
        and(
          eq(niyam_badges.student_id, child1),
          eq(niyam_badges.niyam_id, niyamId),
          eq(niyam_badges.badge_key, "daily_7"),
        ),
      );
    expect(badges).toHaveLength(1);
  });

  it("non-MSV student posting an msv_only niyam id gets 403", async () => {
    const niyamId = await createNiyam(`msv-only-${Date.now()}`, {
      approval_mode: "auto",
      msv_audience: "msv",
    });
    // child1 is seeded msv_status=none
    const res = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child1, submission_date: todayIst() });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ERR_FORBIDDEN");
  });

  it("submission outside [start_date, end_date] returns 422", async () => {
    const niyamId = await createNiyam(`ended-${Date.now()}`, {
      approval_mode: "auto",
      start_date: daysAgoIst(30),
      end_date: daysAgoIst(5),
    });
    const res = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child0, submission_date: todayIst() });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/ended/i);
  });

  it("soft-deleted student returns 404 on submit", async () => {
    const niyamId = await createNiyam(`deleted-stu-${Date.now()}`, { approval_mode: "auto" });
    await db.update(students).set({ deleted_at: new Date() }).where(eq(students.id, child1));
    try {
      const res = await request(app)
        .post("/v1/niyam-submissions")
        .set(auth(parent.token))
        .send({ niyam_id: niyamId, student_id: child1, submission_date: todayIst() });
      expect(res.status).toBe(404);
    } finally {
      await db.update(students).set({ deleted_at: null }).where(eq(students.id, child1));
    }
  });

  it("21st submission in an hour returns 429 ERR_RATE_LIMITED", async () => {
    process.env.JP_TEST_RATE_LIMIT = "1";
    resetMemoryRateLimitsForTests();
    const minKey = `niyam:submit:min:${parent.user.id}`;
    try {
      for (let i = 0; i < 20; i++) {
        const r = await request(app)
          .post("/v1/niyam-submissions")
          .set(auth(parent.token))
          .send({});
        expect(r.status).not.toBe(429);
        // Clear the 5/min bucket so this test exercises the hourly cap specifically.
        clearMemoryRateLimitKeyForTests(minKey);
      }
      const blocked = await request(app)
        .post("/v1/niyam-submissions")
        .set(auth(parent.token))
        .send({});
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("ERR_RATE_LIMITED");
    } finally {
      delete process.env.JP_TEST_RATE_LIMIT;
      resetMemoryRateLimitsForTests();
    }
  });

  it("listing two rows with the same submission_date paginates deterministically", async () => {
    const niyamId = await createNiyam(`page-${Date.now()}`, { approval_mode: "review" });
    const day = todayIst();
    const a = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child0, submission_date: day, proof_url: PROOF });
    expect(a.status).toBe(200);
    // Force same date; second child same day for deterministic id ordering.
    const niyamId2 = await createNiyam(`page2-${Date.now()}`, { approval_mode: "review" });
    const b = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId2, student_id: child0, submission_date: day, proof_url: PROOF });
    expect(b.status).toBe(200);

    await db
      .update(niyam_submissions)
      .set({ submission_date: day })
      .where(eq(niyam_submissions.id, a.body.data.id));
    await db
      .update(niyam_submissions)
      .set({ submission_date: day })
      .where(eq(niyam_submissions.id, b.body.data.id));

    const page1 = await request(app)
      .get("/v1/admin/niyam-submissions?limit=1&status=pending")
      .set(auth(admin.token));
    expect(page1.status).toBe(200);
    expect(page1.body.data.items).toHaveLength(1);
    expect(page1.body.data.next_cursor).toBeTruthy();

    const page2 = await request(app)
      .get(`/v1/admin/niyam-submissions?limit=1&status=pending&cursor=${page1.body.data.next_cursor}`)
      .set(auth(admin.token));
    expect(page2.status).toBe(200);
    expect(page2.body.data.items).toHaveLength(1);
    expect(page2.body.data.items[0].id).not.toBe(page1.body.data.items[0].id);

    // Same cursor again yields the same second page (deterministic).
    const page2b = await request(app)
      .get(`/v1/admin/niyam-submissions?limit=1&status=pending&cursor=${page1.body.data.next_cursor}`)
      .set(auth(admin.token));
    expect(page2b.body.data.items[0].id).toBe(page2.body.data.items[0].id);
  });

  it("recomputeStreak lapses a daily streak that ended 10 days ago; keeps longest + badge", async () => {
    const niyamId = await createNiyam(`lapse-recompute-${Date.now()}`, {
      approval_mode: "auto",
      points: 3,
    });
    for (let i = 16; i >= 10; i--) {
      const d = daysAgoIst(i);
      await db.insert(niyam_submissions).values({
        niyam_id: niyamId,
        student_id: child0,
        submission_date: d,
        period_key: periodKey("daily", d),
        status: "auto_approved",
        points_awarded: 3,
        submitted_by: parent.user.id,
      });
    }
    await db.insert(niyam_streaks).values({
      student_id: child0,
      niyam_id: niyamId,
      current_streak: 7,
      longest_streak: 7,
      last_submission_date: daysAgoIst(10),
      last_period_key: periodKey("daily", daysAgoIst(10)),
    });
    await db.insert(niyam_badges).values({
      student_id: child0,
      niyam_id: niyamId,
      badge_key: "daily_7",
      streak_length: 7,
      points_awarded: 25,
    });

    const result = await recomputeStreak(child0, niyamId, "daily");
    expect(result.current).toBe(0);
    expect(result.longest).toBe(7);

    const [streak] = await db
      .select()
      .from(niyam_streaks)
      .where(and(eq(niyam_streaks.student_id, child0), eq(niyam_streaks.niyam_id, niyamId)))
      .limit(1);
    expect(streak.current_streak).toBe(0);
    expect(streak.longest_streak).toBe(7);
    expect(streak.last_period_key).toBe(periodKey("daily", daysAgoIst(10)));

    const badges = await db
      .select()
      .from(niyam_badges)
      .where(
        and(
          eq(niyam_badges.student_id, child0),
          eq(niyam_badges.niyam_id, niyamId),
          eq(niyam_badges.badge_key, "daily_7"),
        ),
      );
    expect(badges).toHaveLength(1);
  });

  it("recomputeStreak preserves a streak whose last submission was yesterday", async () => {
    const niyamId = await createNiyam(`alive-yesterday-${Date.now()}`, {
      approval_mode: "auto",
      points: 3,
    });
    for (let i = 3; i >= 1; i--) {
      const d = daysAgoIst(i);
      await db.insert(niyam_submissions).values({
        niyam_id: niyamId,
        student_id: child0,
        submission_date: d,
        period_key: periodKey("daily", d),
        status: "auto_approved",
        points_awarded: 3,
        submitted_by: parent.user.id,
      });
    }
    await db.insert(niyam_streaks).values({
      student_id: child0,
      niyam_id: niyamId,
      current_streak: 3,
      longest_streak: 3,
      last_submission_date: daysAgoIst(1),
      last_period_key: periodKey("daily", daysAgoIst(1)),
    });

    const result = await recomputeStreak(child0, niyamId, "daily");
    expect(result.current).toBe(3);
    expect(result.longest).toBe(3);
  });

  it("runNiyamStreakLapse zeroes a stale row and leaves a live one untouched", async () => {
    const staleNiyam = await createNiyam(`lapse-stale-${Date.now()}`, { approval_mode: "auto" });
    const liveNiyam = await createNiyam(`lapse-live-${Date.now()}`, { approval_mode: "auto" });

    await db.insert(niyam_streaks).values({
      student_id: child1,
      niyam_id: staleNiyam,
      current_streak: 5,
      longest_streak: 5,
      last_submission_date: daysAgoIst(10),
      last_period_key: periodKey("daily", daysAgoIst(10)),
    });
    await db.insert(niyam_streaks).values({
      student_id: child1,
      niyam_id: liveNiyam,
      current_streak: 2,
      longest_streak: 2,
      last_submission_date: daysAgoIst(1),
      last_period_key: periodKey("daily", daysAgoIst(1)),
    });

    const { zeroed } = await runNiyamStreakLapse();
    expect(zeroed).toBeGreaterThanOrEqual(1);

    const [stale] = await db
      .select()
      .from(niyam_streaks)
      .where(and(eq(niyam_streaks.student_id, child1), eq(niyam_streaks.niyam_id, staleNiyam)))
      .limit(1);
    const [live] = await db
      .select()
      .from(niyam_streaks)
      .where(and(eq(niyam_streaks.student_id, child1), eq(niyam_streaks.niyam_id, liveNiyam)))
      .limit(1);
    expect(stale.current_streak).toBe(0);
    expect(stale.longest_streak).toBe(5);
    expect(live.current_streak).toBe(2);
  });

  it("awarding a badge inserts a niyam_badge notification with Devanagari title_hi", async () => {
    const niyamId = await createNiyam(`badge-notif-${Date.now()}`, {
      approval_mode: "auto",
      points: 5,
    });
    for (let i = 7; i >= 2; i--) {
      const d = daysAgoIst(i);
      await db.insert(niyam_submissions).values({
        niyam_id: niyamId,
        student_id: child0,
        submission_date: d,
        period_key: periodKey("daily", d),
        status: "auto_approved",
        points_awarded: 5,
        submitted_by: parent.user.id,
      });
    }

    const day7 = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({ niyam_id: niyamId, student_id: child0, submission_date: daysAgoIst(1) });
    expect(day7.status).toBe(200);
    expect(day7.body.data.new_badges?.some((b: { badge_key: string }) => b.badge_key === "daily_7")).toBe(
      true,
    );

    const [note] = await db
      .select({
        kind: notifications.kind,
        title_en: notifications.title_en,
        title_hi: notifications.title_hi,
        body_en: notifications.body_en,
      })
      .from(notifications)
      .where(
        and(eq(notifications.user_id, parent.user.id), eq(notifications.kind, "niyam_badge")),
      )
      .orderBy(desc(notifications.created_at))
      .limit(1);
    expect(note).toBeTruthy();
    expect(note.kind).toBe("niyam_badge");
    expect(note.title_hi).toMatch(/[\u0900-\u097F]/);
    expect(note.body_en).toMatch(/7-day streak/);
    expect(note.body_en).not.toMatch(/daily_7/);
  });

  it("parent with preferred_language hi gets Hindi push copy on rejection", async () => {
    const niyamId = await createNiyam(`hi-push-${Date.now()}`, { approval_mode: "review" });
    const [langBefore] = await db
      .select({ preferred_language: users.preferred_language })
      .from(users)
      .where(eq(users.id, parent.user.id))
      .limit(1);

    const token = `ExponentPushToken[niyam-hi-test-${Date.now()}]`;
    await db.insert(device_push_tokens).values({
      user_id: parent.user.id,
      expo_token: token,
      platform: "ios",
      is_active: true,
    });

    const spy = vi.spyOn(pushModule, "sendPush").mockResolvedValue([]);
    try {
      await db
        .update(users)
        .set({ preferred_language: "hi" })
        .where(eq(users.id, parent.user.id));

      const submit = await request(app)
        .post("/v1/niyam-submissions")
        .set(auth(parent.token))
        .send({
          niyam_id: niyamId,
          student_id: child0,
          submission_date: todayIst(),
          proof_url: PROOF,
        });
      expect(submit.status).toBe(200);

      const reject = await request(app)
        .post(`/v1/niyam-submissions/${submit.body.data.id}/reject`)
        .set(auth(shikshak.token))
        .send({ reason: REJECT_REASON });
      expect(reject.status).toBe(200);

      expect(spy).toHaveBeenCalled();
      const payloads = spy.mock.calls.flatMap((c) => c[0]);
      const rejectionPush = payloads.find(
        (p) => p.data && (p.data as { kind?: string }).kind === "niyam_rejected",
      );
      expect(rejectionPush).toBeTruthy();
      expect(rejectionPush!.title).toBe("नियम जमा अस्वीकृत");
      expect(rejectionPush!.body).toMatch(/अस्वीकृत/);
    } finally {
      spy.mockRestore();
      await db
        .update(users)
        .set({ preferred_language: langBefore.preferred_language })
        .where(eq(users.id, parent.user.id));
      await db.delete(device_push_tokens).where(eq(device_push_tokens.expo_token, token));
    }
  });
});
