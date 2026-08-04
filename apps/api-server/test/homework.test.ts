import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";
import { ulid } from "../src/lib/ulid";

beforeAll(async () => {
  // Soft-delete leftover active assignments from prior unclean runs so /mine
  // (max limit 200) can still see rows minted by this suite.
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

/** Wall-clock mark — afterEach removes assignments created at or after this. */
let testStartedAt = new Date().toISOString();

beforeEach(() => {
  // 1s slack so DB now() cannot land before the Node mark under clock skew.
  testStartedAt = new Date(Date.now() - 1000).toISOString();
});

afterEach(async () => {
  // Suite fixtures only (created_at watermark). Hard-delete so the shared seed
  // DB does not accumulate soft-deleted junk forever; CASCADE clears submissions.
  await pool.query(
    `delete from homework_assignments
      where created_at >= $1::timestamptz`,
    [testStartedAt],
  );
});

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

/**
 * Homework is self-creating: each run resolves the student's batch_id, creates
 * one assignment for that batch, then drives the lifecycle. Rerunnable against
 * a seeded DB — fixtures are deleted in afterEach.
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

async function studentBatchId(studentId: string): Promise<string> {
  const res = await pool.query<{ batch_id: string | null }>(
    `select batch_id from students where id = $1`,
    [studentId],
  );
  expect(res.rows[0]?.batch_id).toBeTruthy();
  return res.rows[0]!.batch_id!;
}

/**
 * Create a brand-new assignment for the student's current batch and return its
 * fresh `pending` submission id. One assignment per call — never scans every batch.
 */
async function freshSubmissionFor(adminToken: string, studentId: string): Promise<string> {
  const created = await freshAssignmentTargeting(adminToken, studentId);
  return created.submissionId;
}

async function freshAssignmentTargeting(
  adminToken: string,
  studentId: string,
): Promise<{ assignmentId: string; submissionId: string; batchId: string }> {
  const batchId = await studentBatchId(studentId);
  const create = await request(app)
    .post("/v1/homework/assignments")
    .set(auth(adminToken))
    .send({
      batch_id: batchId,
      title: `HW ${Date.now()}-${batchId.slice(0, 6)}`,
      due_date: tomorrow(),
    });
  expect(create.status).toBe(200);
  const assignmentId = create.body.data.id as string;

  const subs = await request(app)
    .get(`/v1/homework/assignments/${assignmentId}/submissions`)
    .set(auth(adminToken));
  expect(subs.status).toBe(200);
  const mine = subs.body.data.items.find((s: { student_id: string }) => s.student_id === studentId);
  expect(mine).toBeTruthy();
  return { assignmentId, submissionId: mine!.id as string, batchId };
}

async function totalPunya(parentToken: string, studentId: string): Promise<number> {
  const res = await request(app).get(`/v1/me/students/${studentId}/punya`).set(auth(parentToken));
  expect(res.status).toBe(200);
  return (res.body.data.total_points as number) ?? 0;
}

/** Plant an upload_objects row owned by userId; return a local /uploads URL (F2). */
async function ownedHomeworkUrl(
  userId: string,
  opts?: { ext?: "jpg" | "pdf"; contentType?: string },
): Promise<string> {
  const ext = opts?.ext ?? "jpg";
  const contentType =
    opts?.contentType ?? (ext === "pdf" ? "application/pdf" : "image/jpeg");
  const key = `homework/test-${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  await pool.query(
    `insert into upload_objects (key, uploaded_by, content_type)
     values ($1, $2, $3)
     on conflict (key) do update
       set uploaded_by = excluded.uploaded_by,
           content_type = excluded.content_type`,
    [key, userId, contentType],
  );
  return `http://localhost:8080/uploads/${key}`;
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

    // Aarav (parent's first child) — one assignment on their batch, not every batch.
    const studentId = await firstChildId(parent.token);
    const { assignmentId, submissionId } = await freshAssignmentTargeting(admin.token, studentId);

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
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });
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
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });
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
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });
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
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });

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
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });

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
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });

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
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });

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
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });
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
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });
    expect(resubmit.status).toBe(409);
    expect(resubmit.body.error.code).toBe("ERR_CONFLICT");

    // The grade survived: status stays approved, url not clobbered.
    const feed = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
      .set(auth(parent.token));
    const row = feed.body.data.items.find((r: { id: string }) => r.id === submissionId);
    expect(row.status).toBe("approved");
    expect(row.submission_url).toContain("/uploads/homework/");
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
        .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });
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

    const url = await ownedHomeworkUrl(parent.user.id);
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
    // Signed feed URL still points at the same storage key.
    expect(row.submission_url).toContain(url.split("/uploads/")[1]!.split("?")[0]);
  });

  it("the online route and the sync path produce the same row", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);

    const onlineId = await freshSubmissionFor(admin.token, studentId);
    const syncId = await freshSubmissionFor(admin.token, studentId);
    const url = await ownedHomeworkUrl(parent.user.id);

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
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const batchId = await studentBatchId(studentId);

    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: batchId,
        title: `Atomic HW ${Date.now()}`,
        due_date: tomorrow(),
      });
    expect(create.status).toBe(200);
    const created = create.body.data as { id: string; submissions_created: number };
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
    // Create under real time (FIX #19 rejects past due_date), then plant the
    // historical due date before freezing the clock for submit.
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const { assignmentId, submissionId } = await freshAssignmentTargeting(admin.token, studentId);
    await pool.query(`update homework_assignments set due_date = '2026-03-15' where id = $1`, [
      assignmentId,
    ]);

    vi.useFakeTimers({
      now: new Date("2026-03-15T20:30:00.000Z"),
      toFake: ["Date"],
    });
    try {
      const submit = await request(app)
        .post(`/v1/homework/submissions/${submissionId}/submit`)
        .set(auth(parent.token))
        .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });
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
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe("submitted");
    expect(submit.body.data.late).toBe(false);
  });

  it("a homework sync op resolves the submission from assignment_id + student_id", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const { assignmentId, submissionId } = await freshAssignmentTargeting(admin.token, studentId);
    const url = await ownedHomeworkUrl(parent.user.id);

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
    expect(row.submission_url).toContain(url.split("/uploads/")[1]!.split("?")[0]);
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
              file_url: await ownedHomeworkUrl(parent.user.id),
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
              proof_asset_id: await ownedHomeworkUrl(parent.user.id),
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
    const url = await ownedHomeworkUrl(parent.user.id);

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
              proof_asset_id: await ownedHomeworkUrl(parent.user.id),
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
    // Replay must not re-apply the second payload's URL.
    expect(row.submission_url).toContain(url.split("/uploads/")[1]!.split("?")[0]);
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
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });
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

  it("an is_msv assignment only fans out to MSV-approved students in the batch", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    expect(children.status).toBe(200);
    const kids: Array<{ id: string; msv_status: string; batch_id?: string }> = children.body.data.items;
    const aarav = kids.find((k) => k.msv_status === "approved");
    const diya = kids.find((k) => k.msv_status === "none");
    expect(aarav).toBeTruthy();
    expect(diya).toBeTruthy();

    // Both share batchA1 in seed — create MSV homework on that batch.
    const batchId = (
      await pool.query<{ batch_id: string }>(`select batch_id from students where id = $1`, [aarav!.id])
    ).rows[0]!.batch_id;

    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: batchId,
        title: `MSV-only HW ${Date.now()}`,
        due_date: tomorrow(),
        is_msv: true,
      });
    expect(create.status).toBe(200);

    const subs = await request(app)
      .get(`/v1/homework/assignments/${create.body.data.id}/submissions`)
      .set(auth(admin.token));
    expect(subs.status).toBe(200);
    const studentIds = (subs.body.data.items as Array<{ student_id: string }>).map((s) => s.student_id);
    expect(studentIds).toContain(aarav!.id);
    expect(studentIds).not.toContain(diya!.id);

    for (const sid of studentIds) {
      const row = await pool.query<{ msv_status: string }>(
        `select msv_status from students where id = $1`,
        [sid],
      );
      expect(row.rows[0]!.msv_status).toBe("approved");
    }
  });

  it("a non-MSV student cannot submit against an is_msv assignment", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    const kids: Array<{ id: string; msv_status: string }> = children.body.data.items;
    const diya = kids.find((k) => k.msv_status === "none");
    expect(diya).toBeTruthy();

    const batchId = (
      await pool.query<{ batch_id: string }>(`select batch_id from students where id = $1`, [diya!.id])
    ).rows[0]!.batch_id;

    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: batchId,
        title: `MSV re-check ${Date.now()}`,
        due_date: tomorrow(),
        is_msv: true,
      });
    expect(create.status).toBe(200);

    // Fan-out correctly skipped Diya — plant a row to prove submit re-checks.
    const planted = await pool.query<{ id: string }>(
      `insert into homework_submissions (assignment_id, student_id, status)
       values ($1, $2, 'pending')
       returning id`,
      [create.body.data.id, diya!.id],
    );
    const submissionId = planted.rows[0]!.id;

    const submit = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });
    expect(submit.status).toBe(403);
    expect(submit.body.error.code).toBe("ERR_FORBIDDEN");
  });

  it("a normal assignment still fans out to everyone active", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    const kids: Array<{ id: string; msv_status: string }> = children.body.data.items;
    const aarav = kids.find((k) => k.msv_status === "approved");
    const diya = kids.find((k) => k.msv_status === "none");
    expect(aarav).toBeTruthy();
    expect(diya).toBeTruthy();

    const batchId = (
      await pool.query<{ batch_id: string }>(`select batch_id from students where id = $1`, [aarav!.id])
    ).rows[0]!.batch_id;
    // Same batch for both bal siblings in seed.
    const diyaBatch = (
      await pool.query<{ batch_id: string }>(`select batch_id from students where id = $1`, [diya!.id])
    ).rows[0]!.batch_id;
    expect(diyaBatch).toBe(batchId);

    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: batchId,
        title: `Everyone HW ${Date.now()}`,
        due_date: tomorrow(),
        is_msv: false,
      });
    expect(create.status).toBe(200);

    const subs = await request(app)
      .get(`/v1/homework/assignments/${create.body.data.id}/submissions`)
      .set(auth(admin.token));
    const studentIds = (subs.body.data.items as Array<{ student_id: string }>).map((s) => s.student_id);
    expect(studentIds).toContain(aarav!.id);
    expect(studentIds).toContain(diya!.id);
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
        .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });

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
        .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });

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
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });
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
        .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });

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

  it("re-grading without a feedback_note key preserves existing feedback", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });

    const approve = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved", feedback_note: "Keep this note." });
    expect(approve.status).toBe(200);

    const regrade = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved" }); // no feedback_note key
    expect(regrade.status).toBe(200);

    const feed = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
      .set(auth(parent.token));
    const row = feed.body.data.items.find((r: { id: string }) => r.id === submissionId);
    expect(row.feedback_note).toBe("Keep this note.");
  });

  it("re-grading with feedback_note: null explicitly clears it", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });

    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved", feedback_note: "Will be cleared." });

    const clear = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved", feedback_note: null });
    expect(clear.status).toBe(200);

    const feed = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
      .set(auth(parent.token));
    const row = feed.body.data.items.find((r: { id: string }) => r.id === submissionId);
    expect(row.feedback_note).toBeNull();
  });

  it("the original grader is retained on the submission", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });

    const first = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved", feedback_note: "First look." });
    expect(first.status).toBe(200);

    const before = await pool.query<{ marked_by: string; marked_at: Date }>(
      `select marked_by, marked_at from homework_submissions where id = $1`,
      [submissionId],
    );
    expect(before.rows[0]!.marked_by).toBe(shikshak.user.id);

    // Re-grade as super_admin (different actor) without touching feedback.
    const second = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(admin.token))
      .send({ status: "starred" });
    expect(second.status).toBe(200);

    const after = await pool.query<{ marked_by: string; status: string }>(
      `select marked_by, status from homework_submissions where id = $1`,
      [submissionId],
    );
    expect(after.rows[0]!.status).toBe("starred");
    expect(after.rows[0]!.marked_by).toBe(shikshak.user.id);
  });

  it("creating an assignment enqueues one notification per target student", async () => {
    // Change 4: one per parent for the assignment — Aarav + Diya share a parent,
    // so two target students produce one homework notification (not two).
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    const kids: Array<{ id: string; msv_status: string }> = children.body.data.items;
    const aarav = kids.find((k) => k.msv_status === "approved");
    const diya = kids.find((k) => k.msv_status === "none");
    expect(aarav).toBeTruthy();
    expect(diya).toBeTruthy();

    const batchId = (
      await pool.query<{ batch_id: string }>(`select batch_id from students where id = $1`, [aarav!.id])
    ).rows[0]!.batch_id;

    const before = await pool.query<{ n: string }>(
      `select count(*)::text as n from notifications
        where user_id = $1 and kind = 'homework'`,
      [parent.user.id],
    );
    const beforeN = Number(before.rows[0]!.n);

    const title = `Notify assign ${Date.now()}`;
    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: batchId,
        title,
        due_date: tomorrow(),
        is_msv: false,
      });
    expect(create.status).toBe(200);
    expect(create.body.data.submissions_created).toBeGreaterThanOrEqual(2);

    const after = await pool.query<{ n: string }>(
      `select count(*)::text as n from notifications
        where user_id = $1 and kind = 'homework'`,
      [parent.user.id],
    );
    expect(Number(after.rows[0]!.n) - beforeN).toBe(1);

    const latest = await pool.query<{
      title_en: string;
      title_hi: string;
      body_en: string;
      body_hi: string;
    }>(
      `select title_en, title_hi, body_en, body_hi from notifications
        where user_id = $1 and kind = 'homework'
        order by created_at desc limit 1`,
      [parent.user.id],
    );
    expect(latest.rows[0]!.title_en).toBe("New homework");
    expect(latest.rows[0]!.title_hi).toMatch(/गृहकार्य/);
    expect(latest.rows[0]!.body_en).toContain(title);
    expect(latest.rows[0]!.body_en).toMatch(/Guruji/);
    expect(latest.rows[0]!.body_hi).toMatch(/गुरुजी/);
  });

  it("grading a submission notifies that student's parent", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });

    const before = await pool.query<{ n: string }>(
      `select count(*)::text as n from notifications
        where user_id = $1 and kind = 'homework'`,
      [parent.user.id],
    );
    const beforeN = Number(before.rows[0]!.n);

    const grade = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved" });
    expect(grade.status).toBe(200);

    const after = await pool.query<{ n: string }>(
      `select count(*)::text as n from notifications
        where user_id = $1 and kind = 'homework'`,
      [parent.user.id],
    );
    expect(Number(after.rows[0]!.n)).toBe(beforeN + 1);

    const latest = await pool.query<{ title_en: string; body_en: string; body_hi: string }>(
      `select title_en, body_en, body_hi from notifications
        where user_id = $1 and kind = 'homework'
        order by created_at desc limit 1`,
      [parent.user.id],
    );
    expect(latest.rows[0]!.title_en).toBe("Homework approved");
    expect(latest.rows[0]!.body_en).toMatch(/Guruji approved/);
    expect(latest.rows[0]!.body_hi).toMatch(/गुरुजी/);
  });

  it("a parent who has opted out of push receives no push", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const batchId = (
      await pool.query<{ batch_id: string }>(`select batch_id from students where id = $1`, [studentId])
    ).rows[0]!.batch_id;

    const prev = await pool.query<{ prefs: unknown }>(
      `select notification_preferences as prefs from users where id = $1`,
      [parent.user.id],
    );

    await pool.query(
      `update users set notification_preferences = '{"push": false}'::jsonb where id = $1`,
      [parent.user.id],
    );

    try {
      const before = await pool.query<{ n: string }>(
        `select count(*)::text as n from notifications
          where user_id = $1 and kind = 'homework'`,
        [parent.user.id],
      );
      const beforeN = Number(before.rows[0]!.n);

      const create = await request(app)
        .post("/v1/homework/assignments")
        .set(auth(admin.token))
        .send({
          batch_id: batchId,
          title: `Opt-out HW ${Date.now()}`,
          due_date: tomorrow(),
          target_student_ids: [studentId],
        });
      expect(create.status).toBe(200);

      const after = await pool.query<{ n: string }>(
        `select count(*)::text as n from notifications
          where user_id = $1 and kind = 'homework'`,
        [parent.user.id],
      );
      // prefsAllowKind: push===false skips insert entirely in notifyUsers.
      expect(Number(after.rows[0]!.n)).toBe(beforeN);
    } finally {
      await pool.query(`update users set notification_preferences = $2::jsonb where id = $1`, [
        parent.user.id,
        JSON.stringify(prev.rows[0]?.prefs ?? {}),
      ]);
    }
  });

  it("a student moved into a batch receives its not-yet-due assignments", async () => {
    const { materialiseHomeworkOnBatchJoin } = await import("../src/lib/homework-materialise");
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);

    const home = await pool.query<{ batch_id: string; centre_id: string }>(
      `select batch_id, centre_id from students where id = $1`,
      [studentId],
    );
    const homeBatch = home.rows[0]!.batch_id;

    // Pick a different active batch at the same centre.
    const other = await pool.query<{ id: string }>(
      `select id from batches
        where centre_id = $1 and id <> $2 and deleted_at is null
        limit 1`,
      [home.rows[0]!.centre_id, homeBatch],
    );
    expect(other.rows[0]).toBeTruthy();
    const otherBatch = other.rows[0]!.id;

    const title = `Late-join open ${Date.now()}`;
    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({ batch_id: otherBatch, title, due_date: tomorrow() });
    expect(create.status).toBe(200);
    const assignmentId = create.body.data.id as string;

    // Student is still on homeBatch — should not see the other batch's work yet.
    const before = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
      .set(auth(parent.token));
    expect(before.body.data.items.some((r: { assignment_id: string }) => r.assignment_id === assignmentId)).toBe(
      false,
    );

    await pool.query(`update students set batch_id = $1 where id = $2`, [otherBatch, studentId]);
    const n = await materialiseHomeworkOnBatchJoin(studentId, otherBatch);
    expect(n).toBeGreaterThanOrEqual(1);

    try {
      const after = await request(app)
        .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
        .set(auth(parent.token));
      expect(after.body.data.items.some((r: { assignment_id: string }) => r.assignment_id === assignmentId)).toBe(
        true,
      );
    } finally {
      await pool.query(`update students set batch_id = $1 where id = $2`, [homeBatch, studentId]);
    }
  });

  it("a student moved out does not receive new ones and keeps their history", async () => {
    const { materialiseHomeworkOnBatchJoin } = await import("../src/lib/homework-materialise");
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);

    const home = await pool.query<{ batch_id: string; centre_id: string }>(
      `select batch_id, centre_id from students where id = $1`,
      [studentId],
    );
    const homeBatch = home.rows[0]!.batch_id;

    const { assignmentId, submissionId } = await freshAssignmentTargeting(admin.token, studentId);

    const other = await pool.query<{ id: string }>(
      `select id from batches
        where centre_id = $1 and id <> $2 and deleted_at is null
        limit 1`,
      [home.rows[0]!.centre_id, homeBatch],
    );
    const otherBatch = other.rows[0]!.id;

    await pool.query(`update students set batch_id = $1 where id = $2`, [otherBatch, studentId]);
    await materialiseHomeworkOnBatchJoin(studentId, otherBatch);

    try {
      // History from the old batch remains.
      const mine = await request(app)
        .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
        .set(auth(parent.token));
      expect(mine.body.data.items.some((r: { id: string }) => r.id === submissionId)).toBe(true);

      // New work on the old batch must not appear for the departed student.
      const create = await request(app)
        .post("/v1/homework/assignments")
        .set(auth(admin.token))
        .send({
          batch_id: homeBatch,
          title: `After move ${Date.now()}`,
          due_date: tomorrow(),
        });
      expect(create.status).toBe(200);
      const newId = create.body.data.id as string;

      const after = await request(app)
        .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
        .set(auth(parent.token));
      expect(after.body.data.items.some((r: { assignment_id: string }) => r.assignment_id === newId)).toBe(
        false,
      );
      // Original assignment still present.
      expect(after.body.data.items.some((r: { assignment_id: string }) => r.assignment_id === assignmentId)).toBe(
        true,
      );
    } finally {
      await pool.query(`update students set batch_id = $1 where id = $2`, [homeBatch, studentId]);
    }
  });

  it("past-due assignments are NOT back-created for a late joiner", async () => {
    const { materialiseHomeworkOnBatchJoin } = await import("../src/lib/homework-materialise");
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);

    const home = await pool.query<{ batch_id: string; centre_id: string }>(
      `select batch_id, centre_id from students where id = $1`,
      [studentId],
    );
    const homeBatch = home.rows[0]!.batch_id;
    const other = await pool.query<{ id: string }>(
      `select id from batches
        where centre_id = $1 and id <> $2 and deleted_at is null
        limit 1`,
      [home.rows[0]!.centre_id, homeBatch],
    );
    const otherBatch = other.rows[0]!.id;

    const yesterday = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 2);
      return d.toISOString().slice(0, 10);
    })();

    // Bypass API past-date guard (FIX #19) — plant a past-due row directly.
    const planted = await pool.query<{ id: string }>(
      `insert into homework_assignments (batch_id, title, due_date, is_msv)
       values ($1, $2, $3, false)
       returning id`,
      [otherBatch, `Past due late-join ${Date.now()}`, yesterday],
    );
    const pastId = planted.rows[0]!.id;

    await pool.query(`update students set batch_id = $1 where id = $2`, [otherBatch, studentId]);
    await materialiseHomeworkOnBatchJoin(studentId, otherBatch);

    try {
      const mine = await request(app)
        .get(`/v1/homework/mine?student_id=${studentId}&limit=200`)
        .set(auth(parent.token));
      expect(mine.body.data.items.some((r: { assignment_id: string }) => r.assignment_id === pastId)).toBe(
        false,
      );
    } finally {
      await pool.query(`update students set batch_id = $1 where id = $2`, [homeBatch, studentId]);
      await pool.query(`update homework_assignments set deleted_at = now() where id = $1`, [pastId]);
    }
  });

  it("the second page returns the next set with no overlap", async () => {
    const admin = await loginAs("super_admin");
    const batchesRes = await request(app).get("/v1/admin/batches").set(auth(admin.token));
    expect(batchesRes.status).toBe(200);
    const batchId = batchesRes.body.data.items[0].id as string;

    const createdIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const create = await request(app)
        .post("/v1/homework/assignments")
        .set(auth(admin.token))
        .send({
          batch_id: batchId,
          title: `Page HW ${Date.now()}-${i}`,
          due_date: tomorrow(),
        });
      expect(create.status).toBe(200);
      createdIds.push(create.body.data.id as string);
      // Distinct created_at for stable keyset ordering across fast inserts.
      await new Promise((r) => setTimeout(r, 15));
    }

    const page1 = await request(app)
      .get(`/v1/homework/assignments?batch_id=${batchId}&limit=2`)
      .set(auth(admin.token));
    expect(page1.status).toBe(200);
    expect(page1.body.data.items).toHaveLength(2);
    expect(page1.body.meta?.next_cursor).toBeTruthy();

    const page2 = await request(app)
      .get(
        `/v1/homework/assignments?batch_id=${batchId}&limit=2&cursor=${encodeURIComponent(page1.body.meta.next_cursor)}`,
      )
      .set(auth(admin.token));
    expect(page2.status).toBe(200);
    expect(page2.body.data.items.length).toBeGreaterThanOrEqual(1);

    const ids1 = new Set(page1.body.data.items.map((r: { id: string }) => r.id));
    const ids2 = page2.body.data.items.map((r: { id: string }) => r.id);
    for (const id of ids2) {
      expect(ids1.has(id)).toBe(false);
    }
    // Our freshly created rows must appear across the pages (no silent drop).
    const seen = new Set([...ids1, ...ids2]);
    for (const id of createdIds) {
      expect(seen.has(id)).toBe(true);
    }
  });

  it("the meta block reports whether more rows exist", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);

    // Ensure enough /mine rows to force a second page.
    for (let i = 0; i < 3; i++) {
      await freshAssignmentTargeting(admin.token, studentId);
      await new Promise((r) => setTimeout(r, 10));
    }

    const page1 = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}&limit=2`)
      .set(auth(parent.token));
    expect(page1.status).toBe(200);
    expect(page1.body.data.items).toHaveLength(2);
    expect(page1.body.meta?.has_more).toBe(true);
    expect(typeof page1.body.meta?.next_cursor).toBe("string");
    expect(page1.body.meta.next_cursor.length).toBeGreaterThan(0);

    const page2 = await request(app)
      .get(
        `/v1/homework/mine?student_id=${studentId}&limit=2&cursor=${encodeURIComponent(page1.body.meta.next_cursor)}`,
      )
      .set(auth(parent.token));
    expect(page2.status).toBe(200);
    expect(page2.body.meta?.has_more).toBeDefined();
    expect(typeof page2.body.meta.has_more).toBe("boolean");
  });

  it("the counts are identical before and after", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);

    // Assignment with a normal fan-out (pending rows).
    const withSubs = await freshAssignmentTargeting(admin.token, studentId);

    // Submit + grade one so submitted/graded are non-zero.
    const submit = await request(app)
      .post(`/v1/homework/submissions/${withSubs.submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });
    expect(submit.status).toBe(200);
    const grade = await request(app)
      .post(`/v1/homework/submissions/${withSubs.submissionId}/grade`)
      .set(auth(admin.token))
      .send({ status: "approved", feedback_note: "ok" });
    expect(grade.status).toBe(200);

    // Zero-submission case: assignment on an empty batch (LEFT JOIN / LATERAL
    // must both report total=0, not drop the row).
    const emptyBatch = await pool.query<{ id: string }>(
      `insert into batches (centre_id, name, age_groups, day_of_week, start_time, end_time, capacity, status)
       select centre_id, $1, array['bal']::age_group_enum[], array[6]::integer[], '10:00', '11:00', 20, 'active'
         from batches where deleted_at is null limit 1
       returning id`,
      [`Empty HW batch ${Date.now()}`],
    );
    const emptyBatchId = emptyBatch.rows[0]!.id;
    const zero = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: emptyBatchId,
        title: `Zero-sub ${Date.now()}`,
        due_date: tomorrow(),
      });
    expect(zero.status).toBe(200);
    const zeroId = zero.body.data.id as string;

    // Ground truth — same FILTER semantics the list endpoint must preserve.
    const expected = await pool.query<{
      id: string;
      total: number;
      submitted: number;
      graded: number;
    }>(
      `select ha.id,
              count(hs.id)::int as total,
              count(hs.id) filter (where hs.status in ('submitted','approved','starred','late'))::int as submitted,
              count(hs.id) filter (where hs.status in ('approved','starred'))::int as graded
         from homework_assignments ha
         left join homework_submissions hs on hs.assignment_id = ha.id
        where ha.id = any($1::uuid[])
        group by ha.id`,
      [[withSubs.assignmentId, zeroId]],
    );
    const byId = new Map(expected.rows.map((r) => [r.id, r]));

    const list = await request(app)
      .get(`/v1/homework/assignments?limit=200`)
      .set(auth(admin.token));
    expect(list.status).toBe(200);
    const items: Array<{ id: string; total: number; submitted: number; graded: number }> =
      list.body.data.items;

    const gotWith = items.find((r) => r.id === withSubs.assignmentId);
    const gotZero = items.find((r) => r.id === zeroId);
    expect(gotWith).toBeTruthy();
    expect(gotZero).toBeTruthy();

    const expWith = byId.get(withSubs.assignmentId)!;
    const expZero = byId.get(zeroId)!;
    expect(Number(gotWith!.total)).toBe(Number(expWith.total));
    expect(Number(gotWith!.submitted)).toBe(Number(expWith.submitted));
    expect(Number(gotWith!.graded)).toBe(Number(expWith.graded));
    expect(Number(gotZero!.total)).toBe(0);
    expect(Number(gotZero!.submitted)).toBe(0);
    expect(Number(gotZero!.graded)).toBe(0);
    expect(Number(expZero.total)).toBe(0);

    await pool.query(`update homework_assignments set deleted_at = now() where id = $1`, [zeroId]);
    await pool.query(`update batches set deleted_at = now() where id = $1`, [emptyBatchId]);
  });

  it("a malformed student_id returns 422, not 404", async () => {
    const parent = await loginAs("parent");
    const res = await request(app)
      .get("/v1/homework/mine?student_id=not-a-uuid")
      .set(auth(parent.token));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });

  it("creating an assignment with a past due date is rejected", async () => {
    const admin = await loginAs("super_admin");
    const batchesRes = await request(app).get("/v1/admin/batches").set(auth(admin.token));
    const batchId = batchesRes.body.data.items[0].id as string;

    const { kolkataDateString } = await import("../src/services/attendance-mark");
    // Far enough in the past that Asia/Kolkata "today" cannot collide.
    const pastDate = "2020-01-15";
    expect(pastDate < kolkataDateString(new Date())).toBe(true);

    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: batchId,
        title: `Past due ${Date.now()}`,
        due_date: pastDate,
      });
    expect(create.status).toBe(422);
    expect(create.body.error.code).toBe("ERR_VALIDATION_FAILED");
    expect(create.body.error.message).toBe(
      "That due date has already passed — pick today or a later date.",
    );
  });

  it("today's date is accepted", async () => {
    const admin = await loginAs("super_admin");
    const batchesRes = await request(app).get("/v1/admin/batches").set(auth(admin.token));
    const batchId = batchesRes.body.data.items[0].id as string;

    const { kolkataDateString } = await import("../src/services/attendance-mark");
    const today = kolkataDateString(new Date());

    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: batchId,
        title: `Due today ${Date.now()}`,
        due_date: today,
      });
    expect(create.status).toBe(200);
    expect(create.body.data.id).toBeTruthy();
  });

  it("two simultaneous grade requests award Punya exactly once", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    const submit = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });
    expect(submit.status).toBe(200);

    const before = await totalPunya(parent.token, studentId);

    const [a, b] = await Promise.all([
      request(app)
        .post(`/v1/homework/submissions/${submissionId}/grade`)
        .set(auth(admin.token))
        .send({ status: "approved", feedback_note: "a" }),
      request(app)
        .post(`/v1/homework/submissions/${submissionId}/grade`)
        .set(auth(admin.token))
        .send({ status: "approved", feedback_note: "b" }),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Both responses see the same final balance — only one claim awarded.
    expect(a.body.data.total_points).toBe(b.body.data.total_points);
    expect(a.body.data.total_points).toBeGreaterThan(before);

    const after = await totalPunya(parent.token, studentId);
    expect(after).toBe(a.body.data.total_points);

    const awards = await pool.query<{ n: string; pts: string }>(
      `select count(*)::text as n, coalesce(sum(points), 0)::text as pts
         from punya_transactions
        where source_entity_id = $1
          and source_entity_kind = 'homework'
          and points > 0
          and idempotency_key not like '%:reversal'`,
      [submissionId],
    );
    expect(Number(awards.rows[0]!.n)).toBe(1);
    expect(after - before).toBe(Number(awards.rows[0]!.pts));
  });

  it("target_student_ids creates submissions only for the listed students", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    const kids: Array<{ id: string; batch_id?: string }> = children.body.data.items;
    const aarav = kids[0];
    const diya = kids[1];
    expect(aarav).toBeTruthy();
    expect(diya).toBeTruthy();

    const batchId = await studentBatchId(aarav!.id);
    // Diya shares Aarav's batch in seed — listing only Aarav must exclude Diya.
    const diyaBatch = await studentBatchId(diya!.id);
    expect(diyaBatch).toBe(batchId);

    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: batchId,
        title: `Subset HW ${Date.now()}`,
        due_date: tomorrow(),
        target_student_ids: [aarav!.id],
      });
    expect(create.status).toBe(200);
    expect(create.body.data.submissions_created).toBe(1);

    const subs = await request(app)
      .get(`/v1/homework/assignments/${create.body.data.id}/submissions`)
      .set(auth(admin.token));
    expect(subs.status).toBe(200);
    const ids = (subs.body.data.items as Array<{ student_id: string }>).map((s) => s.student_id);
    expect(ids).toEqual([aarav!.id]);
  });

  it("a student id not active in the batch is rejected with 422", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const batchId = await studentBatchId(studentId);

    // Pune student is active, but not in this Mumbai batch.
    const pune = await pool.query<{ id: string }>(
      `select id from students where student_code = 'STU000004' limit 1`,
    );
    expect(pune.rows[0]).toBeTruthy();

    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: batchId,
        title: `Bad target ${Date.now()}`,
        due_date: tomorrow(),
        target_student_ids: [pune.rows[0]!.id],
      });
    expect(create.status).toBe(422);
    expect(create.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });

  it("a city_admin cannot grade a submission outside their city", async () => {
    const admin = await loginAs("super_admin");
    const cityAdmin = await loginAs("city_admin"); // Mumbai

    const pune = await pool.query<{ id: string; batch_id: string }>(
      `select id, batch_id from students where student_code = 'STU000004' limit 1`,
    );
    expect(pune.rows[0]?.batch_id).toBeTruthy();

    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: pune.rows[0]!.batch_id,
        title: `Pune HW ${Date.now()}`,
        due_date: tomorrow(),
        target_student_ids: [pune.rows[0]!.id],
      });
    expect(create.status).toBe(200);

    const planted = await pool.query<{ id: string }>(
      `update homework_submissions
          set status = 'submitted',
              submission_url = 'https://example.com/pune.jpg'
        where assignment_id = $1 and student_id = $2
      returning id`,
      [create.body.data.id, pune.rows[0]!.id],
    );
    const submissionId = planted.rows[0]!.id;

    const denied = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(cityAdmin.token))
      .send({ status: "approved" });
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe("ERR_NOT_FOUND");

    const allowed = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(admin.token))
      .send({ status: "approved" });
    expect(allowed.status).toBe(200);
  });

  it("a sanchalak can grade across every batch at their assigned centre", async () => {
    const admin = await loginAs("super_admin");
    const sanchalak = await loginAs("sanchalak");
    const shikshak = await loginAs("shikshak");

    const allBatches = await request(app).get("/v1/admin/batches").set(auth(admin.token));
    const batchList: Array<{ id: string; name: string }> = allBatches.body.data.items;

    // Batch at the sanchalak's centre that the seeded shikshak is NOT assigned to.
    const outsider = batchList.find((b) => b.name === "Tarun Batch - Unassigned Scope Fixture");
    expect(outsider).toBeTruthy();

    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: outsider!.id,
        title: `Centre-wide HW ${Date.now()}`,
        due_date: tomorrow(),
      });
    expect(create.status).toBe(200);

    // Plant a submitted row — fixture batch may have no roster students.
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const planted = await pool.query<{ id: string }>(
      `insert into homework_submissions (assignment_id, student_id, status, submission_url)
       values ($1, $2, 'submitted', 'https://example.com/sanchalak-scope.jpg')
       on conflict (assignment_id, student_id) do update
         set status = 'submitted',
             submission_url = excluded.submission_url
       returning id`,
      [create.body.data.id, studentId],
    );
    const submissionId = planted.rows[0]!.id;

    const asShikshak = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "approved" });
    expect(asShikshak.status).toBe(404);

    const asSanchalak = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(sanchalak.token))
      .send({ status: "approved" });
    expect(asSanchalak.status).toBe(200);
    expect(asSanchalak.body.data.status).toBe("approved");
  });

  it("an assignment for a batch with no active students creates zero submissions and still returns 200", async () => {
    const admin = await loginAs("super_admin");
    const emptyBatch = await pool.query<{ id: string }>(
      `insert into batches (centre_id, name, age_groups, day_of_week, start_time, end_time, capacity, status)
       select centre_id, $1, array['bal']::age_group_enum[], array[6]::integer[], '10:00', '11:00', 20, 'active'
         from batches where deleted_at is null limit 1
       returning id`,
      [`Empty roster ${Date.now()}`],
    );
    const emptyBatchId = emptyBatch.rows[0]!.id;

    try {
      const create = await request(app)
        .post("/v1/homework/assignments")
        .set(auth(admin.token))
        .send({
          batch_id: emptyBatchId,
          title: `Empty batch HW ${Date.now()}`,
          due_date: tomorrow(),
        });
      expect(create.status).toBe(200);
      expect(create.body.data.submissions_created).toBe(0);
      expect(create.body.data.id).toBeTruthy();

      const counted = await pool.query<{ n: string }>(
        `select count(*)::text as n from homework_submissions where assignment_id = $1`,
        [create.body.data.id],
      );
      expect(Number(counted.rows[0]!.n)).toBe(0);
    } finally {
      await pool.query(`update batches set deleted_at = now() where id = $1`, [emptyBatchId]);
    }
  });

  /* ─── F1 — mark-done acknowledgement ─── */

  it("a parent can mark a homework item done without a url", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    const res = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/mark-done`)
      .set(auth(parent.token))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("acknowledged");
    expect(res.body.data.late).toBe(false);

    const row = await pool.query<{ status: string; submission_url: string | null }>(
      `select status, submission_url from homework_submissions where id = $1`,
      [submissionId],
    );
    expect(row.rows[0]!.status).toBe("acknowledged");
    expect(row.rows[0]!.submission_url).toBeNull();
  });

  it("marking done does not award Punya", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);
    const before = await totalPunya(parent.token, studentId);

    const res = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/mark-done`)
      .set(auth(parent.token))
      .send({});
    expect(res.status).toBe(200);

    const after = await totalPunya(parent.token, studentId);
    expect(after).toBe(before);
  });

  it("a graded submission cannot be marked done", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });
    const grade = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(admin.token))
      .send({ status: "approved" });
    expect(grade.status).toBe(200);

    const res = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/mark-done`)
      .set(auth(parent.token))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ERR_CONFLICT");
  });

  it("mark-done replays idempotently through /v1/sync/batch", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);
    const opId = ulid();

    const first = await request(app)
      .post("/v1/sync/batch")
      .set(auth(parent.token))
      .send({
        ops: [
          {
            submission_op_id: opId,
            op_type: "acknowledgement",
            payload: { kind: "homework.mark_done", entity_id: submissionId },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });
    expect(first.status).toBe(200);
    expect(first.body.data.results[0].status).toBe("success");
    expect(first.body.data.results[0].data.status).toBe("acknowledged");

    const replay = await request(app)
      .post("/v1/sync/batch")
      .set(auth(parent.token))
      .send({
        ops: [
          {
            submission_op_id: opId,
            op_type: "acknowledgement",
            payload: { kind: "homework.mark_done", entity_id: submissionId },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });
    expect(replay.status).toBe(200);
    expect(replay.body.data.results[0].status).toBe("success");
    expect(replay.body.data.results[0].data.status).toBe("acknowledged");
  });

  it("an acknowledgement op with kind 'homework' resolves the right submission", async () => {
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
            op_type: "acknowledgement",
            payload: { kind: "homework", entity_id: submissionId },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });
    expect(sync.status).toBe(200);
    expect(sync.body.data.results[0].status).toBe("success");
    expect(sync.body.data.results[0].server_id).toBe(submissionId);

    const row = await pool.query<{ status: string }>(
      `select status from homework_submissions where id = $1`,
      [submissionId],
    );
    expect(row.rows[0]!.status).toBe("acknowledged");
  });

  /* ─── F9 — return for rework ─── */

  it("returning a submission awards no Punya and reopens it for resubmission", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });

    const before = await totalPunya(parent.token, studentId);
    const ret = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(admin.token))
      .send({ status: "returned", feedback_note: "Please recite the full mantra." });
    expect(ret.status).toBe(200);
    expect(ret.body.data.status).toBe("returned");
    expect(ret.body.data.points_reversed ?? 0).toBe(0);

    const after = await totalPunya(parent.token, studentId);
    expect(after).toBe(before);

    const resubmit = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.data.status).toMatch(/^(submitted|late)$/);
  });

  it("a returned submission can be resubmitted, then graded normally", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });
    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(admin.token))
      .send({ status: "returned", feedback_note: "Try again with clearer writing." });

    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });

    const before = await totalPunya(parent.token, studentId);
    const grade = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(admin.token))
      .send({ status: "approved" });
    expect(grade.status).toBe(200);
    expect(grade.body.data.status).toBe("approved");
    expect(grade.body.data.total_points).toBeGreaterThan(before);
  });

  it("returning an already-approved submission reverses the awarded Punya", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });

    const before = await totalPunya(parent.token, studentId);
    const grade = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(admin.token))
      .send({ status: "approved" });
    expect(grade.status).toBe(200);
    expect(grade.body.data.total_points).toBeGreaterThan(before);

    const ret = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(admin.token))
      .send({ status: "returned", feedback_note: "Sorry — please redo this chapter." });
    expect(ret.status).toBe(200);
    expect(ret.body.data.status).toBe("returned");
    expect(ret.body.data.points_reversed).toBeGreaterThan(0);

    const after = await totalPunya(parent.token, studentId);
    expect(after).toBe(before);
  });

  it("feedback_note is required when returning", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: await ownedHomeworkUrl(parent.user.id) });

    const empty = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(admin.token))
      .send({ status: "returned", feedback_note: "   " });
    expect(empty.status).toBe(422);
    expect(empty.body.error.code).toBe("ERR_VALIDATION_FAILED");

    const missing = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(admin.token))
      .send({ status: "returned" });
    expect(missing.status).toBe(422);
  });

  /* ─── F2 — verify uploads against upload_objects ─── */

  it("a submission url not present in upload_objects is rejected", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    const res = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: "http://localhost:8080/uploads/homework/missing-key.jpg" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });

  it("a submission url uploaded by a different user is rejected", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const other = await loginAs("shikshak");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);
    const foreignUrl = await ownedHomeworkUrl(other.user.id);

    const res = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: foreignUrl });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });

  it("a non-image, non-pdf upload is rejected with a helpful message", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);
    const key = `homework/test-video-${Date.now()}.mp4`;
    await pool.query(
      `insert into upload_objects (key, uploaded_by, content_type)
       values ($1, $2, 'video/mp4')
       on conflict (key) do update set uploaded_by = excluded.uploaded_by, content_type = excluded.content_type`,
      [key, parent.user.id],
    );
    const url = `http://localhost:8080/uploads/${key}`;

    const res = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: url });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/image or pdf/i);
  });

  it("an external https url is rejected", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const submissionId = await freshSubmissionFor(admin.token, studentId);

    const res = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: "https://drive.google.com/file/d/abc/view" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });

  /* ─── F13 — assignment attachments ─── */

  it("an assignment created with an attachment returns a signed url in /mine", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const batchId = await studentBatchId(studentId);
    const attachmentUrl = await ownedHomeworkUrl(admin.user.id, { ext: "pdf" });

    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: batchId,
        title: `Worksheet HW ${Date.now()}`,
        due_date: tomorrow(),
        attachment_url: attachmentUrl,
      });
    expect(create.status).toBe(200);

    const feed = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}&limit=50`)
      .set(auth(parent.token));
    expect(feed.status).toBe(200);
    const row = feed.body.data.items.find(
      (r: { assignment_id: string }) => r.assignment_id === create.body.data.id,
    );
    expect(row).toBeTruthy();
    expect(row.attachment_url).toContain("/uploads/homework/");
  });

  it("the attachment is rejected if it is not an admin-owned upload", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const batchId = await studentBatchId(studentId);
    const foreign = await ownedHomeworkUrl(parent.user.id);

    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: batchId,
        title: `Bad attachment HW ${Date.now()}`,
        due_date: tomorrow(),
        attachment_url: foreign,
      });
    expect(create.status).toBe(422);
    expect(create.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });
});
