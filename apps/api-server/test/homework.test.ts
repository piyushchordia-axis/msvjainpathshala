import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";
import { ulid } from "../src/lib/ulid";

beforeAll(async () => {
  // Soft-delete leftover assignments from prior runs so /mine (max limit 200)
  // can still see rows minted by this suite.
  await pool.query(`update homework_assignments set deleted_at = now() where deleted_at is null`);
  // AT21 catalogue rows (migration 0021) — idempotent for DBs that have not migrated yet.
  await pool.query(`
    INSERT INTO punya_features (key, label, min_points, max_points, is_active)
    SELECT 'homework', 'Homework approved', 0, 10, true
    WHERE NOT EXISTS (SELECT 1 FROM punya_features WHERE key = 'homework');
    INSERT INTO punya_features (key, label, min_points, max_points, is_active)
    SELECT 'homework_starred', 'Homework starred', 0, 12, true
    WHERE NOT EXISTS (SELECT 1 FROM punya_features WHERE key = 'homework_starred');
  `);
});

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
  const created = await freshAssignmentTargeting(adminToken, studentId);
  return created.submissionId;
}

async function freshAssignmentTargeting(
  adminToken: string,
  studentId: string,
): Promise<{ assignmentId: string; submissionId: string }> {
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
    if (mine) {
      return { assignmentId: create.body.data.id as string, submissionId: mine.id as string };
    }
  }
  throw new Error("could not create a submission targeting the student");
}

async function totalPunya(parentToken: string, studentId: string): Promise<number> {
  const res = await request(app).get(`/v1/me/students/${studentId}/punya`).set(auth(parentToken));
  expect(res.status).toBe(200);
  return (res.body.data.total_points as number) ?? 0;
}

async function studentCityId(studentId: string): Promise<string> {
  const res = await pool.query<{ city_id: string }>(
    `select c.city_id
       from students s
       join batches b on b.id = s.batch_id
       join centres c on c.id = b.centre_id
      where s.id = $1`,
    [studentId],
  );
  expect(res.rows[0]?.city_id).toBeTruthy();
  return res.rows[0]!.city_id;
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
      .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
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
      .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
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
    // Superseded by AT18 differential re-grade — kept title so older diffs still
    // grep; behaviour is asserted in "approved -> starred re-grade…".
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const studentId = await firstChildId(parent.token);

    const submissionId = await freshSubmissionFor(admin.token, studentId);
    const submit = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: "https://example.com/regrade.jpg" });
    expect(submit.status).toBe(200);

    const before = await totalPunya(parent.token, studentId);

    const approve = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved", feedback_note: "Good." });
    expect(approve.status).toBe(200);

    const afterApprove = await totalPunya(parent.token, studentId);
    const awarded = afterApprove - before;
    expect(awarded).toBeGreaterThan(0);

    // Same status again — identical point value → no ledger move (AT18).
    const again = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved", feedback_note: "Still good." });
    expect(again.status).toBe(200);
    expect(await totalPunya(parent.token, studentId)).toBe(afterApprove);
  });

  it("un-grading reverses the awarded Punya exactly once", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: "https://example.com/ungrade-once.jpg" });

    const before = await totalPunya(parent.token, studentId);
    const grade = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved" });
    expect(grade.status).toBe(200);
    const afterGrade = await totalPunya(parent.token, studentId);
    expect(afterGrade - before).toBeGreaterThan(0);

    const ungrade = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/ungrade`)
      .set(auth(shikshak.token));
    expect(ungrade.status).toBe(200);
    expect(ungrade.body.data.status).toMatch(/^(submitted|late)$/);
    expect(await totalPunya(parent.token, studentId)).toBe(before);
  });

  it("un-grading twice does not double-debit", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: "https://example.com/ungrade-twice.jpg" });

    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "starred" });

    const first = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/ungrade`)
      .set(auth(shikshak.token));
    expect(first.status).toBe(200);
    const afterFirst = await totalPunya(parent.token, studentId);

    const second = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/ungrade`)
      .set(auth(shikshak.token));
    expect(second.status).toBe(409);
    expect(await totalPunya(parent.token, studentId)).toBe(afterFirst);
  });

  it("re-grading after an un-grade awards again", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: "https://example.com/regrade-after-ungrade.jpg" });

    const before = await totalPunya(parent.token, studentId);
    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved" });
    const afterFirst = await totalPunya(parent.token, studentId);
    const firstAward = afterFirst - before;
    expect(firstAward).toBeGreaterThan(0);

    const ungrade = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/ungrade`)
      .set(auth(shikshak.token));
    expect(ungrade.status).toBe(200);
    expect(await totalPunya(parent.token, studentId)).toBe(before);

    const regrade = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved" });
    expect(regrade.status).toBe(200);
    expect(await totalPunya(parent.token, studentId)).toBe(before + firstAward);
  });

  it("approved -> starred re-grade reverses the old value and awards the new", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: "https://example.com/approve-to-star.jpg" });

    const before = await totalPunya(parent.token, studentId);
    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved" });
    const afterApprove = await totalPunya(parent.token, studentId);
    const approvePts = afterApprove - before;
    expect(approvePts).toBe(10);

    const star = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "starred", feedback_note: "Even better." });
    expect(star.status).toBe(200);
    expect(star.body.data.status).toBe("starred");

    const afterStar = await totalPunya(parent.token, studentId);
    // Net = starred (12), not approve+star (22) and not stuck at approve (10).
    expect(afterStar - before).toBe(12);

    const feed = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
      .set(auth(parent.token));
    const graded = feed.body.data.items.find((r: { id: string }) => r.id === submissionId);
    expect(graded.status).toBe("starred");
    expect(graded.feedback_note).toBe("Even better.");
  });

  it("grading a pending submission is rejected and awards no Punya", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const studentId = await firstChildId(parent.token);

    const submissionId = await freshSubmissionFor(admin.token, studentId);
    const before = await totalPunya(parent.token, studentId);

    const grade = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved" });
    expect(grade.status).toBe(409);
    expect(grade.body.error.code).toBe("ERR_CONFLICT");
    expect(grade.body.error.message).toMatch(/upload their work/i);

    expect(await totalPunya(parent.token, studentId)).toBe(before);

    const feed = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
      .set(auth(parent.token));
    const row = feed.body.data.items.find((r: { id: string }) => r.id === submissionId);
    expect(row.status).toBe("pending");
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
      .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
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

  it("a deactivated student's homework feed returns 404", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);

    try {
      const deact = await request(app)
        .post(`/v1/admin/students/${studentId}/status`)
        .set(auth(admin.token))
        .send({ action: "deactivate" });
      expect(deact.status).toBe(200);
      expect(deact.body.data.status).toBe("inactive");

      const feed = await request(app)
        .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
        .set(auth(parent.token));
      expect(feed.status).toBe(404);
      expect(feed.body.error.code).toBe("ERR_NOT_FOUND");
    } finally {
      await request(app)
        .post(`/v1/admin/students/${studentId}/status`)
        .set(auth(admin.token))
        .send({ action: "reactivate" });
    }
  });

  it("a deactivated student cannot submit homework", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    try {
      const deact = await request(app)
        .post(`/v1/admin/students/${studentId}/status`)
        .set(auth(admin.token))
        .send({ action: "deactivate" });
      expect(deact.status).toBe(200);

      const submit = await request(app)
        .post(`/v1/homework/submissions/${submissionId}/submit`)
        .set(auth(parent.token))
        .send({ submission_url: "https://example.com/after-deactivate.jpg" });
      expect(submit.status).toBe(404);
      expect(submit.body.error.code).toBe("ERR_NOT_FOUND");
    } finally {
      await request(app)
        .post(`/v1/admin/students/${studentId}/status`)
        .set(auth(admin.token))
        .send({ action: "reactivate" });
    }
  });

  it("an offline homework op with a non-http url is rejected", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    const sync = await request(app)
      .post("/v1/sync/batch")
      .set(auth(parent.token))
      .send({
        ops: [
          {
            submission_op_id: ulid(),
            op_type: "homework_submission",
            payload: {
              submission_id: submissionId,
              file_url: "javascript:alert(1)",
            },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });
    expect(sync.status).toBe(200);
    const result = sync.body.data.results[0];
    expect(result.status).toBe("failed");
    expect(result.error.code).toBe("ERR_VALIDATION_FAILED");
  });

  it("an offline homework op without a url does not erase an existing submission", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    const url = "https://example.com/keep-me.jpg";
    const online = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: url });
    expect(online.status).toBe(200);

    const sync = await request(app)
      .post("/v1/sync/batch")
      .set(auth(parent.token))
      .send({
        ops: [
          {
            submission_op_id: ulid(),
            op_type: "homework_submission",
            payload: { submission_id: submissionId },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });
    expect(sync.status).toBe(200);
    expect(sync.body.data.results[0].status).toBe("success");

    const feed = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
      .set(auth(parent.token));
    const row = feed.body.data.items.find((r: { id: string }) => r.id === submissionId);
    expect(row.submission_url).toBe(url);
  });

  it("the online route and the sync path produce the same row", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);

    const onlineId = await freshSubmissionFor(admin.token, studentId);
    const syncId = await freshSubmissionFor(admin.token, studentId);
    const url = "https://example.com/parity.jpg";

    const online = await request(app)
      .post(`/v1/homework/submissions/${onlineId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: url });
    expect(online.status).toBe(200);

    const sync = await request(app)
      .post("/v1/sync/batch")
      .set(auth(parent.token))
      .send({
        ops: [
          {
            submission_op_id: ulid(),
            op_type: "homework_submission",
            payload: { submission_id: syncId, file_url: url },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });
    expect(sync.status).toBe(200);
    expect(sync.body.data.results[0].status).toBe("success");

    const feed = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
      .set(auth(parent.token));
    const onlineRow = feed.body.data.items.find((r: { id: string }) => r.id === onlineId);
    const syncRow = feed.body.data.items.find((r: { id: string }) => r.id === syncId);
    expect(onlineRow).toBeTruthy();
    expect(syncRow).toBeTruthy();
    expect(onlineRow.status).toBe(syncRow.status);
    expect(onlineRow.late).toBe(syncRow.late);
    expect(onlineRow.submission_url).toBe(syncRow.submission_url);
  });

  it("an assignment and its submissions are created atomically", async () => {
    const admin = await loginAs("super_admin");
    const batchesRes = await request(app).get("/v1/admin/batches").set(auth(admin.token));
    expect(batchesRes.status).toBe(200);
    // Prefer a batch that has active students so fan-out is non-empty.
    let batchId = "";
    let created = { id: "", submissions_created: 0 };
    for (const b of batchesRes.body.data.items as Array<{ id: string }>) {
      const create = await request(app)
        .post("/v1/homework/assignments")
        .set(auth(admin.token))
        .send({
          batch_id: b.id,
          title: `Atomic HW ${Date.now()}-${b.id.slice(0, 6)}`,
          due_date: tomorrow(),
        });
      expect(create.status).toBe(200);
      if (create.body.data.submissions_created > 0) {
        batchId = b.id;
        created = create.body.data;
        break;
      }
    }
    expect(batchId).toBeTruthy();
    expect(created.submissions_created).toBeGreaterThan(0);

    const counted = await pool.query(
      `select count(*)::int as n from homework_submissions where assignment_id = $1`,
      [created.id],
    );
    expect(counted.rows[0].n).toBe(created.submissions_created);

    const orphan = await pool.query(
      `select a.id
         from homework_assignments a
         left join homework_submissions s on s.assignment_id = a.id
        where a.id = $1
        group by a.id
       having count(s.id) = 0`,
      [created.id],
    );
    expect(orphan.rows).toHaveLength(0);
  });

  it("a submission made at 02:00 IST on the day after the due date is late", async () => {
    // 02:00 IST on 2026-03-16 == 2026-03-15T20:30:00.000Z — UTC date is still
    // the due day, so a UTC comparison would wrongly mark this on-time.
    vi.useFakeTimers({
      now: new Date("2026-03-15T20:30:00.000Z"),
      toFake: ["Date"],
    });
    try {
      const admin = await loginAs("super_admin");
      const parent = await loginAs("parent");
      const studentId = await firstChildId(parent.token);

      const batchesRes = await request(app).get("/v1/admin/batches").set(auth(admin.token));
      let submissionId = "";
      for (const b of batchesRes.body.data.items as Array<{ id: string }>) {
        const create = await request(app)
          .post("/v1/homework/assignments")
          .set(auth(admin.token))
          .send({
            batch_id: b.id,
            title: `Late IST ${Date.now()}`,
            due_date: "2026-03-15",
          });
        expect(create.status).toBe(200);
        const subs = await request(app)
          .get(`/v1/homework/assignments/${create.body.data.id}/submissions`)
          .set(auth(admin.token));
        const mine = subs.body.data.items.find((s: { student_id: string }) => s.student_id === studentId);
        if (mine) {
          submissionId = mine.id;
          break;
        }
      }
      expect(submissionId).toBeTruthy();

      const submit = await request(app)
        .post(`/v1/homework/submissions/${submissionId}/submit`)
        .set(auth(parent.token))
        .send({ submission_url: "https://example.com/late-ist.jpg" });
      expect(submit.status).toBe(200);
      expect(submit.body.data.status).toBe("late");
      expect(submit.body.data.late).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an on-time submission is not marked late", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    const submit = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: "https://example.com/on-time.jpg" });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe("submitted");
    expect(submit.body.data.late).toBe(false);
  });

  it("a homework sync op resolves the submission from assignment_id + student_id", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const { assignmentId, submissionId } = await freshAssignmentTargeting(admin.token, studentId);
    const url = "https://example.com/resolved-pair.jpg";

    const sync = await request(app)
      .post("/v1/sync/batch")
      .set(auth(parent.token))
      .send({
        ops: [
          {
            submission_op_id: ulid(),
            op_type: "homework_submission",
            payload: {
              assignment_id: assignmentId,
              student_id: studentId,
              proof_asset_id: url,
            },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });
    expect(sync.status).toBe(200);
    expect(sync.body.data.results[0].status).toBe("success");
    expect(sync.body.data.results[0].server_id).toBe(submissionId);

    const feed = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
      .set(auth(parent.token));
    const row = feed.body.data.items.find((r: { id: string }) => r.id === submissionId);
    expect(row.status).toBe("submitted");
    expect(row.submission_url).toBe(url);
  });

  it("submission_id still works", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    const sync = await request(app)
      .post("/v1/sync/batch")
      .set(auth(parent.token))
      .send({
        ops: [
          {
            submission_op_id: ulid(),
            op_type: "homework_submission",
            payload: {
              submission_id: submissionId,
              file_url: "https://example.com/by-submission-id.jpg",
            },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });
    expect(sync.status).toBe(200);
    expect(sync.body.data.results[0].status).toBe("success");
    expect(sync.body.data.results[0].server_id).toBe(submissionId);
  });

  it("an unresolvable pair fails with ERR_NOT_FOUND, not ERR_VALIDATION_FAILED", async () => {
    const parent = await loginAs("parent");
    const sync = await request(app)
      .post("/v1/sync/batch")
      .set(auth(parent.token))
      .send({
        ops: [
          {
            submission_op_id: ulid(),
            op_type: "homework_submission",
            payload: {
              assignment_id: "11111111-1111-1111-1111-111111111111",
              student_id: "22222222-2222-2222-2222-222222222222",
              proof_asset_id: "https://example.com/x.jpg",
            },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });
    expect(sync.status).toBe(200);
    const result = sync.body.data.results[0];
    expect(result.status).toBe("failed");
    expect(result.error.code).toBe("ERR_NOT_FOUND");
  });

  it("replaying the same submission_op_id returns the stored response and does not re-execute", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const { assignmentId, submissionId } = await freshAssignmentTargeting(admin.token, studentId);
    const opId = ulid();
    const url = "https://example.com/replay-once.jpg";

    const first = await request(app)
      .post("/v1/sync/batch")
      .set(auth(parent.token))
      .send({
        ops: [
          {
            submission_op_id: opId,
            op_type: "homework_submission",
            payload: {
              assignment_id: assignmentId,
              student_id: studentId,
              proof_asset_id: url,
            },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });
    expect(first.status).toBe(200);
    expect(first.body.data.results[0].status).toBe("success");

    // Second submit via online would 409 if graded; here we only check replay
    // does not re-apply — change URL would stick if re-executed.
    const second = await request(app)
      .post("/v1/sync/batch")
      .set(auth(parent.token))
      .send({
        ops: [
          {
            submission_op_id: opId,
            op_type: "homework_submission",
            payload: {
              assignment_id: assignmentId,
              student_id: studentId,
              proof_asset_id: "https://example.com/should-not-apply.jpg",
            },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });
    expect(second.status).toBe(200);
    expect(second.body.data.results[0].status).toBe("success");
    expect(second.body.data.results[0].server_id).toBe(first.body.data.results[0].server_id);

    const feed = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
      .set(auth(parent.token));
    const row = feed.body.data.items.find((r: { id: string }) => r.id === submissionId);
    expect(row.submission_url).toBe(url);
  });

  it("an assignment can be edited within scope", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const { assignmentId } = await freshAssignmentTargeting(admin.token, studentId);

    const patch = await request(app)
      .patch(`/v1/homework/assignments/${assignmentId}`)
      .set(auth(admin.token))
      .send({
        title: "Edited title",
        description: "Edited description",
        due_date: tomorrow(),
        is_msv: true,
      });
    expect(patch.status).toBe(200);
    expect(patch.body.data.title).toBe("Edited title");
    expect(patch.body.data.description).toBe("Edited description");
    expect(patch.body.data.is_msv).toBe(true);

    const list = await request(app).get("/v1/homework/assignments?limit=200").set(auth(admin.token));
    const row = list.body.data.items.find((a: { id: string }) => a.id === assignmentId);
    expect(row).toBeTruthy();
    expect(row.title).toBe("Edited title");
  });

  it("an out-of-scope shikshak cannot edit", async () => {
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
        .send({ batch_id: b.id, title: `edit-probe ${b.id.slice(0, 8)}`, due_date: tomorrow() });
      if (probe.status === 200) assignedIds.add(b.id);
    }

    const outsider = batchList.find(
      (b) => !assignedIds.has(b.id) && b.name === "Tarun Batch - Unassigned Scope Fixture",
    );
    expect(outsider).toBeTruthy();

    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: outsider!.id,
        title: `Out-of-scope edit ${Date.now()}`,
        due_date: tomorrow(),
      });
    expect(create.status).toBe(200);

    const patch = await request(app)
      .patch(`/v1/homework/assignments/${create.body.data.id}`)
      .set(auth(shikshak.token))
      .send({ title: "Should not apply" });
    expect(patch.status).toBe(404);
    expect(patch.body.error.code).toBe("ERR_NOT_FOUND");
  });

  it("a deleted assignment disappears from /mine and the admin list", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const { assignmentId } = await freshAssignmentTargeting(admin.token, studentId);

    const beforeMine = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
      .set(auth(parent.token));
    expect(beforeMine.body.data.items.some((r: { assignment_id: string }) => r.assignment_id === assignmentId)).toBe(
      true,
    );

    const delRes = await request(app)
      .delete(`/v1/homework/assignments/${assignmentId}`)
      .set(auth(admin.token))
      .send({});
    expect(delRes.status).toBe(200);

    const afterMine = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
      .set(auth(parent.token));
    expect(afterMine.body.data.items.some((r: { assignment_id: string }) => r.assignment_id === assignmentId)).toBe(
      false,
    );

    const list = await request(app).get("/v1/homework/assignments?limit=200").set(auth(admin.token));
    expect(list.body.data.items.some((a: { id: string }) => a.id === assignmentId)).toBe(false);
  });

  it("deleting an assignment with graded submissions is blocked without force", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const studentId = await firstChildId(parent.token);
    const { assignmentId, submissionId } = await freshAssignmentTargeting(admin.token, studentId);

    const submit = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: "https://example.com/graded-then-delete.jpg" });
    expect(submit.status).toBe(200);

    const grade = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved" });
    expect(grade.status).toBe(200);

    const blocked = await request(app)
      .delete(`/v1/homework/assignments/${assignmentId}`)
      .set(auth(admin.token))
      .send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("ERR_CONFLICT");
    expect(String(blocked.body.error.message)).toMatch(/1/);

    const stillThere = await request(app).get("/v1/homework/assignments?limit=200").set(auth(admin.token));
    expect(stillThere.body.data.items.some((a: { id: string }) => a.id === assignmentId)).toBe(true);

    const forced = await request(app)
      .delete(`/v1/homework/assignments/${assignmentId}`)
      .set(auth(admin.token))
      .send({ force_delete: true });
    expect(forced.status).toBe(200);

    const gone = await request(app).get("/v1/homework/assignments?limit=200").set(auth(admin.token));
    expect(gone.body.data.items.some((a: { id: string }) => a.id === assignmentId)).toBe(false);
  });

  it("homework points come from punya_configs when a city override exists", async () => {
    const { clearHomeworkPointsCache } = await import("../src/lib/homework-points");
    clearHomeworkPointsCache();

    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const studentId = await firstChildId(parent.token);
    const cityId = await studentCityId(studentId);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    await pool.query(
      `insert into punya_configs (feature_key, points, city_id, is_active)
       values ('homework', 25, $1, true)`,
      [cityId],
    );
    clearHomeworkPointsCache();

    try {
      await request(app)
        .post(`/v1/homework/submissions/${submissionId}/submit`)
        .set(auth(parent.token))
        .send({ submission_url: "https://example.com/city-override.jpg" });

      const before = await totalPunya(parent.token, studentId);
      const grade = await request(app)
        .post(`/v1/homework/submissions/${submissionId}/grade`)
        .set(auth(shikshak.token))
        .send({ status: "approved" });
      expect(grade.status).toBe(200);
      expect(await totalPunya(parent.token, studentId)).toBe(before + 25);
    } finally {
      await pool.query(
        `delete from punya_configs where feature_key = 'homework' and city_id = $1 and points = 25`,
        [cityId],
      );
      clearHomeworkPointsCache();
    }
  });

  it("homework points fall back to the global config, then to the default", async () => {
    const { clearHomeworkPointsCache } = await import("../src/lib/homework-points");
    clearHomeworkPointsCache();

    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const studentId = await firstChildId(parent.token);
    const cityId = await studentCityId(studentId);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    // Ensure no city override shadows the global row.
    await pool.query(`delete from punya_configs where feature_key = 'homework' and city_id = $1`, [
      cityId,
    ]);
    await pool.query(
      `insert into punya_configs (feature_key, points, city_id, is_active)
       values ('homework', 7, null, true)`,
    );
    clearHomeworkPointsCache();

    try {
      await request(app)
        .post(`/v1/homework/submissions/${submissionId}/submit`)
        .set(auth(parent.token))
        .send({ submission_url: "https://example.com/global-fallback.jpg" });

      const before = await totalPunya(parent.token, studentId);
      const grade = await request(app)
        .post(`/v1/homework/submissions/${submissionId}/grade`)
        .set(auth(shikshak.token))
        .send({ status: "approved" });
      expect(grade.status).toBe(200);
      expect(await totalPunya(parent.token, studentId)).toBe(before + 7);
    } finally {
      await pool.query(
        `delete from punya_configs where feature_key = 'homework' and city_id is null and points = 7`,
      );
      clearHomeworkPointsCache();
    }

    // No configs → punya_features.max_points (10).
    const submissionId2 = await freshSubmissionFor(admin.token, studentId);
    await request(app)
      .post(`/v1/homework/submissions/${submissionId2}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: "https://example.com/feature-default.jpg" });
    const before2 = await totalPunya(parent.token, studentId);
    const grade2 = await request(app)
      .post(`/v1/homework/submissions/${submissionId2}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved" });
    expect(grade2.status).toBe(200);
    expect(await totalPunya(parent.token, studentId)).toBe(before2 + 10);
  });

  it("the starred bonus is configurable and not a hardcoded multiplier", async () => {
    const { clearHomeworkPointsCache } = await import("../src/lib/homework-points");
    clearHomeworkPointsCache();

    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const studentId = await firstChildId(parent.token);
    const cityId = await studentCityId(studentId);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    await pool.query(
      `insert into punya_configs (feature_key, points, city_id, is_active)
       values
         ('homework', 10, $1, true),
         ('homework_starred', 50, $1, true)`,
      [cityId],
    );
    clearHomeworkPointsCache();

    try {
      await request(app)
        .post(`/v1/homework/submissions/${submissionId}/submit`)
        .set(auth(parent.token))
        .send({ submission_url: "https://example.com/starred-config.jpg" });

      const before = await totalPunya(parent.token, studentId);
      await request(app)
        .post(`/v1/homework/submissions/${submissionId}/grade`)
        .set(auth(shikshak.token))
        .send({ status: "approved" });
      expect(await totalPunya(parent.token, studentId)).toBe(before + 10);

      const star = await request(app)
        .post(`/v1/homework/submissions/${submissionId}/grade`)
        .set(auth(shikshak.token))
        .send({ status: "starred" });
      expect(star.status).toBe(200);
      // Configurable 50 — not Math.round(10 * 1.2) = 12.
      expect(await totalPunya(parent.token, studentId)).toBe(before + 50);
    } finally {
      await pool.query(
        `delete from punya_configs
          where city_id = $1
            and feature_key in ('homework', 'homework_starred')
            and points in (10, 50)`,
        [cityId],
      );
      clearHomeworkPointsCache();
    }
  });
});
