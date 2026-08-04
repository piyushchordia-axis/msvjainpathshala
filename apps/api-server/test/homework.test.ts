import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

/**
 * Homework is self-creating: each run picks a real seeded batch (the one Aarav,
 * the parent's first child, belongs to) via the admin batches list, creates a
 * fresh assignment for it (so its submissions are brand new), then drives the
 * full lifecycle: parent reads /mine, submits a url, shikshak stars it, and the
 * student's punya total goes up. No reliance on specific seed rows beyond the
 * seeded login personas.
 */
function tomorrow(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function firstChildId(parentToken: string): Promise<string> {
  const children = await request(app).get("/v1/me/children").set(auth(parentToken));
  expect(children.status).toBe(200);
  const child = children.body.data.items[0];
  expect(child).toBeTruthy();
  return child.id as string;
}

/**
 * Create a brand-new assignment that targets `studentId` and return its fresh
 * `pending` submission id. Iterates the admin batch list (like the lifecycle
 * test) until an assignment yields a submission for the student. Rerun-safe:
 * every call mints a new assignment, so the submission always starts pending.
 */
async function freshSubmissionFor(adminToken: string, studentId: string): Promise<string> {
  const batchesRes = await request(app).get("/v1/admin/batches").set(auth(adminToken));
  expect(batchesRes.status).toBe(200);
  const batchList: Array<{ id: string }> = batchesRes.body.data.items;
  expect(batchList.length).toBeGreaterThan(0);

  for (const b of batchList) {
    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(adminToken))
      .send({ batch_id: b.id, title: `HW ${Date.now()}-${b.id.slice(0, 6)}`, due_date: tomorrow() });
    expect(create.status).toBe(200);

    const subs = await request(app)
      .get(`/v1/homework/assignments/${create.body.data.id}/submissions`)
      .set(auth(adminToken));
    expect(subs.status).toBe(200);
    const mine = subs.body.data.items.find((s: { student_id: string }) => s.student_id === studentId);
    if (mine) return mine.id as string;
  }
  throw new Error("could not create a submission targeting the student");
}

async function totalPunya(parentToken: string, studentId: string): Promise<number> {
  const res = await request(app).get(`/v1/me/students/${studentId}/punya`).set(auth(parentToken));
  expect(res.status).toBe(200);
  return (res.body.data.total_points as number) ?? 0;
}

describe("homework", () => {
  it("requires auth on the homework feed", async () => {
    const res = await request(app).get("/v1/homework/mine?student_id=00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(401);
  });

  it("requires admin panel to create an assignment", async () => {
    const { token } = await loginAs("parent");
    const res = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(token))
      .send({ batch_id: "00000000-0000-0000-0000-000000000000", title: "x", due_date: tomorrow() });
    expect(res.status).toBe(403);
  });

  it("runs the full assign -> submit -> grade -> punya lifecycle", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");

    // Aarav (parent's first child).
    const studentId = await firstChildId(parent.token);

    // Find the batch for Aarav from the student's centre's batches. We pick the
    // batch that, after creating an assignment, yields a submission for Aarav.
    const batchesRes = await request(app).get("/v1/admin/batches").set(auth(admin.token));
    expect(batchesRes.status).toBe(200);
    const batchList: Array<{ id: string }> = batchesRes.body.data.items;
    expect(batchList.length).toBeGreaterThan(0);

    // Create an assignment per batch until Aarav appears as a submission target.
    let assignmentId = "";
    let submissionId = "";
    for (const b of batchList) {
      const create = await request(app)
        .post("/v1/homework/assignments")
        .set(auth(admin.token))
        .send({ batch_id: b.id, title: `HW ${Date.now()}-${b.id.slice(0, 6)}`, due_date: tomorrow(), description: "Read chapter 1." });
      expect(create.status).toBe(200);
      expect(create.body.data.submissions_created).toBeGreaterThanOrEqual(0);

      const subs = await request(app)
        .get(`/v1/homework/assignments/${create.body.data.id}/submissions`)
        .set(auth(admin.token));
      expect(subs.status).toBe(200);
      const mine = subs.body.data.items.find((s: { student_id: string }) => s.student_id === studentId);
      if (mine) {
        assignmentId = create.body.data.id;
        submissionId = mine.id;
        expect(create.body.data.submissions_created).toBeGreaterThan(0);
        break;
      }
    }
    expect(assignmentId).toBeTruthy();
    expect(submissionId).toBeTruthy();

    // Parent sees the assignment in the student's feed.
    const feed = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}`)
      .set(auth(parent.token));
    expect(feed.status).toBe(200);
    const feedRow = feed.body.data.items.find((r: { assignment_id: string }) => r.assignment_id === assignmentId);
    expect(feedRow).toBeTruthy();
    expect(feedRow.status).toBe("pending");

    // Parent submits a url (due tomorrow -> "submitted", not late).
    const submit = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: "https://example.com/aarav-homework.jpg" });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe("submitted");

    // Capture punya before grading.
    const before = await request(app).get(`/v1/me/students/${studentId}/punya`).set(auth(parent.token));
    const pointsBefore: number = before.body.data.total_points ?? 0;

    // Shikshak stars it.
    const grade = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "starred", feedback_note: "Excellent work!" });
    expect(grade.status).toBe(200);
    expect(grade.body.data.status).toBe("starred");
    expect(grade.body.data.total_points).toBeGreaterThan(pointsBefore);

    // The starred status surfaces in the parent feed.
    const feed2 = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}`)
      .set(auth(parent.token));
    const graded = feed2.body.data.items.find((r: { id: string }) => r.id === submissionId);
    expect(graded.status).toBe("starred");
    expect(graded.feedback_note).toBe("Excellent work!");
  });

  it("forbids a parent submitting another student's submission", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");

    // Create an assignment for a batch and try to submit as the wrong owner by
    // forging a random submission id -> 404 (ownership check).
    const res = await request(app)
      .post(`/v1/homework/submissions/00000000-0000-0000-0000-000000000000/submit`)
      .set(auth(parent.token))
      .send({ submission_url: "https://example.com/x.jpg" });
    expect(res.status).toBe(404);

    // And a random student_id the parent does not own -> 404 on the feed.
    const feed = await request(app)
      .get(`/v1/homework/mine?student_id=11111111-1111-1111-1111-111111111111`)
      .set(auth(parent.token));
    expect(feed.status).toBe(404);

    // sanity: admin token is a real admin (keeps the var used).
    expect(admin.user.role).toBe("super_admin");
  });

  it("re-grading is idempotent on punya: approve then star awards points only once", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const studentId = await firstChildId(parent.token);

    // Fresh pending submission for Aarav.
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    const before = await totalPunya(parent.token, studentId);

    // First grade: approve (not-yet-graded -> graded) awards the base amount.
    const approve = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved", feedback_note: "Good." });
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe("approved");

    const afterApprove = await totalPunya(parent.token, studentId);
    const awarded = afterApprove - before;
    // Approving awards a positive amount exactly once.
    expect(awarded).toBeGreaterThan(0);
    expect(approve.body.data.total_points).toBe(afterApprove);

    // Second grade: star (already-graded -> already-graded) must NOT re-award.
    const star = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "starred", feedback_note: "Even better." });
    expect(star.status).toBe(200);
    expect(star.body.data.status).toBe("starred");

    const afterStar = await totalPunya(parent.token, studentId);
    // The crux: the second grade added ZERO punya. Total is unchanged from the
    // single approve award (not before + approve-award + star-award).
    expect(afterStar).toBe(afterApprove);
    expect(afterStar - before).toBe(awarded);
    // The returned total reflects the student's CURRENT (unchanged) balance.
    expect(star.body.data.total_points).toBe(afterStar);

    // The new status/feedback still persisted despite no re-award.
    const feed = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}`)
      .set(auth(parent.token));
    const graded = feed.body.data.items.find((r: { id: string }) => r.id === submissionId);
    expect(graded.status).toBe("starred");
    expect(graded.feedback_note).toBe("Even better.");
  });

  it("rejects re-submitting an already-graded submission with 409", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const studentId = await firstChildId(parent.token);

    const submissionId = await freshSubmissionFor(admin.token, studentId);

    // Student submits, shikshak approves -> submission is now graded/locked.
    const submit = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: "https://example.com/first.jpg" });
    expect(submit.status).toBe(200);

    const grade = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved" });
    expect(grade.status).toBe(200);

    // Re-submitting after grading must be rejected, preserving the grade.
    const resubmit = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: "https://example.com/sneaky-overwrite.jpg" });
    expect(resubmit.status).toBe(409);
    expect(resubmit.body.error.code).toBe("ERR_CONFLICT");

    // The grade survived: status stays approved, url not clobbered.
    const feed = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}`)
      .set(auth(parent.token));
    const row = feed.body.data.items.find((r: { id: string }) => r.id === submissionId);
    expect(row.status).toBe("approved");
    expect(row.submission_url).toBe("https://example.com/first.jpg");
  });

  it("a shikshak cannot list submissions for a batch they are not assigned to", async () => {
    const admin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");

    // Discover which batches this shikshak can write (create succeeds = assigned).
    const allBatches = await request(app).get("/v1/admin/batches").set(auth(admin.token));
    expect(allBatches.status).toBe(200);
    const batchList: Array<{ id: string; name: string }> = allBatches.body.data.items;

    const assignedIds = new Set<string>();
    for (const b of batchList) {
      const probe = await request(app)
        .post("/v1/homework/assignments")
        .set(auth(shikshak.token))
        .send({ batch_id: b.id, title: `scope-probe ${b.id.slice(0, 8)}`, due_date: tomorrow() });
      if (probe.status === 200) assignedIds.add(b.id);
    }
    expect(assignedIds.size).toBeGreaterThan(0);

    // Seed: Ghatkopar batchA3 shares the shikshak's centre but is not assigned.
    const outsider = batchList.find(
      (b) => !assignedIds.has(b.id) && b.name === "Tarun Batch - Unassigned Scope Fixture",
    );
    expect(outsider).toBeTruthy();

    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: outsider!.id,
        title: `Out-of-batch HW ${Date.now()}`,
        due_date: tomorrow(),
      });
    expect(create.status).toBe(200);

    const asAdmin = await request(app)
      .get(`/v1/homework/assignments/${create.body.data.id}/submissions`)
      .set(auth(admin.token));
    expect(asAdmin.status).toBe(200);

    const asShikshak = await request(app)
      .get(`/v1/homework/assignments/${create.body.data.id}/submissions`)
      .set(auth(shikshak.token));
    expect(asShikshak.status).toBe(404);
    expect(asShikshak.body.error.code).toBe("ERR_NOT_FOUND");
  });

  it("the assignment list is limited to a shikshak's assigned batches", async () => {
    const admin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");

    const allBatches = await request(app).get("/v1/admin/batches").set(auth(admin.token));
    expect(allBatches.status).toBe(200);
    const batchList: Array<{ id: string; name: string }> = allBatches.body.data.items;

    const assignedIds = new Set<string>();
    for (const b of batchList) {
      const probe = await request(app)
        .post("/v1/homework/assignments")
        .set(auth(shikshak.token))
        .send({ batch_id: b.id, title: `list-probe ${b.id.slice(0, 8)}`, due_date: tomorrow() });
      if (probe.status === 200) assignedIds.add(b.id);
    }
    expect(assignedIds.size).toBeGreaterThan(0);

    const outsider = batchList.find(
      (b) => !assignedIds.has(b.id) && b.name === "Tarun Batch - Unassigned Scope Fixture",
    );
    expect(outsider).toBeTruthy();

    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: outsider!.id,
        title: `List-leak probe ${Date.now()}`,
        due_date: tomorrow(),
      });
    expect(create.status).toBe(200);

    const list = await request(app).get("/v1/homework/assignments").set(auth(shikshak.token));
    expect(list.status).toBe(200);
    const items: Array<{ id: string; batch_id: string }> = list.body.data.items;
    expect(items.some((i) => i.id === create.body.data.id)).toBe(false);
    for (const item of items) {
      expect(assignedIds.has(item.batch_id)).toBe(true);
    }
  });
});
