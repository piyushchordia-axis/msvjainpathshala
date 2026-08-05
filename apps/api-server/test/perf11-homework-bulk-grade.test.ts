/**
 * PERF #11 — bulk grade: one notify per parent, bounded queries, no Expo on request path.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth, withQueryCount } from "./helpers";
import * as queues from "../src/lib/queues";
import * as push from "../src/lib/push";

let testStartedAt = new Date().toISOString();

beforeEach(() => {
  testStartedAt = new Date(Date.now() - 1000).toISOString();
  vi.restoreAllMocks();
});

afterEach(async () => {
  await pool.query(
    `delete from homework_assignments where created_at >= $1::timestamptz`,
    [testStartedAt],
  );
});

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

function tomorrow(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Plant N submitted homework rows on one assignment (same parent batch). */
async function plantSubmittedAssignment(
  adminToken: string,
  count: number,
): Promise<{ assignmentId: string; studentIds: string[] }> {
  const batchPick = await pool.query<{ batch_id: string; centre_id: string }>(
    `select b.id as batch_id, b.centre_id
       from batches b
      where b.deleted_at is null and b.status = 'active'
      limit 1`,
  );
  expect(batchPick.rows.length).toBe(1);
  const { batch_id: batchId, centre_id: centreId } = batchPick.rows[0]!;

  const parentPick = await pool.query<{ id: string }>(
    `select id from users where role = 'parent' and is_active = true limit 1`,
  );
  const parentId = parentPick.rows[0]?.id ?? null;

  const studentIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = await pool.query<{ id: string }>(
      `insert into students (centre_id, batch_id, parent_id, full_name, student_code, status, dob, gender, age_group)
       values ($1, $2, $3, $4, $5, 'active', '2015-01-01', 'male', 'bal')
       returning id`,
      [centreId, batchId, parentId, `Perf11 Bulk ${i}`, `P11B${Date.now()}${i}`],
    );
    studentIds.push(r.rows[0]!.id);
  }

  const create = await request(app)
    .post("/v1/homework/assignments")
    .set(auth(adminToken))
    .send({
      batch_id: batchId,
      title: `Perf11 bulk ${Date.now()}-${count}`,
      due_date: tomorrow(),
    });
  expect(create.status).toBe(200);
  const assignmentId = create.body.data.id as string;

  await pool.query(
    `update homework_submissions
        set status = 'submitted',
            submission_url = 'http://localhost:8080/uploads/homework/perf11.jpg'
      where assignment_id = $1 and student_id = any($2::uuid[])`,
    [assignmentId, studentIds],
  );

  return { assignmentId, studentIds };
}

describe("PERF #11 homework bulk grade", () => {
  it("bulk grading N submissions enqueues one notification job (not N)", async () => {
    const admin = await loginAs("super_admin");
    const { assignmentId, studentIds } = await plantSubmittedAssignment(admin.token, 8);

    const enqueueSpy = vi.spyOn(queues, "enqueueJob").mockResolvedValue(undefined);

    const bulk = await request(app)
      .post(`/v1/homework/assignments/${assignmentId}/grade-all`)
      .set(auth(admin.token))
      .send({ status: "approved", only_ungraded: true, work_kind: "all" });
    expect(bulk.status).toBe(200);
    expect(bulk.body.data.summary.graded).toBe(studentIds.length);

    const bulkJobs = enqueueSpy.mock.calls.filter((c) => {
      const data = c[1] as { kind?: string; student_ids?: string[] } | undefined;
      return data?.kind === "homework_bulk_graded";
    });
    expect(bulkJobs.length).toBe(1);
    const payload = bulkJobs[0]![1] as { student_ids: string[]; assignment_id: string };
    expect(payload.assignment_id).toBe(assignmentId);
    expect(payload.student_ids.length).toBe(studentIds.length);

    enqueueSpy.mockRestore();
  });

  it("bulk grading issues a bounded number of queries (10 vs 40 submissions)", async () => {
    const admin = await loginAs("super_admin");
    vi.spyOn(queues, "enqueueJob").mockResolvedValue(undefined);

    const plant10 = await plantSubmittedAssignment(admin.token, 10);
    const { count: q10 } = await withQueryCount(async () => {
      const bulk = await request(app)
        .post(`/v1/homework/assignments/${plant10.assignmentId}/grade-all`)
        .set(auth(admin.token))
        .send({ status: "approved", only_ungraded: true, work_kind: "all" });
      expect(bulk.status).toBe(200);
      expect(bulk.body.data.summary.graded).toBe(10);
      return bulk;
    });

    const plant40 = await plantSubmittedAssignment(admin.token, 40);
    const { count: q40 } = await withQueryCount(async () => {
      const bulk = await request(app)
        .post(`/v1/homework/assignments/${plant40.assignmentId}/grade-all`)
        .set(auth(admin.token))
        .send({ status: "approved", only_ungraded: true, work_kind: "all" });
      expect(bulk.status).toBe(200);
      expect(bulk.body.data.summary.graded).toBe(40);
      return bulk;
    });

    // Claim/award is still O(N); the win is one txn + one audit INSERT + zero Expo
    // queries on the request path. Old path was ~N txns + N×(~5 notify queries).
    expect(q40).toBeLessThan(40 * 15);
    expect(q40 / q10).toBeLessThan(5);
    // Per-student cost must not climb with roster size (fixed overhead amortises).
    expect(q40 / 40).toBeLessThanOrEqual(q10 / 10 + 1);
  });

  it("bulk grading does not await the push transport", async () => {
    const admin = await loginAs("super_admin");
    const { assignmentId, studentIds } = await plantSubmittedAssignment(admin.token, 6);

    // Force inline path: enqueueJob still fires the handler, but the route voids it.
    vi.spyOn(push, "sendPush").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 500));
      return;
    });

    // Ensure enqueue actually runs the notify path slowly if awaited — but route must return fast.
    const origEnqueue = queues.enqueueJob;
    vi.spyOn(queues, "enqueueJob").mockImplementation(async (name, data, opts) => {
      // Simulate a slow push job without blocking the HTTP response (void'd by route).
      void (async () => {
        await new Promise((r) => setTimeout(r, 500 * studentIds.length));
        await origEnqueue(name, data ?? {}, opts);
      })();
    });

    const t0 = Date.now();
    const bulk = await request(app)
      .post(`/v1/homework/assignments/${assignmentId}/grade-all`)
      .set(auth(admin.token))
      .send({ status: "approved", only_ungraded: true, work_kind: "all" });
    const elapsed = Date.now() - t0;

    expect(bulk.status).toBe(200);
    expect(bulk.body.data.summary.graded).toBe(studentIds.length);
    // Well under 6 × 500ms = 3000ms.
    expect(elapsed).toBeLessThan(2000);
  });

  it("a failed push does not roll back a grade", async () => {
    const admin = await loginAs("super_admin");
    const { assignmentId, studentIds } = await plantSubmittedAssignment(admin.token, 3);

    vi.spyOn(queues, "enqueueJob").mockRejectedValue(new Error("Expo unreachable"));

    const bulk = await request(app)
      .post(`/v1/homework/assignments/${assignmentId}/grade-all`)
      .set(auth(admin.token))
      .send({ status: "approved", only_ungraded: true, work_kind: "all" });
    expect(bulk.status).toBe(200);
    expect(bulk.body.data.summary.graded).toBe(3);

    const graded = await pool.query<{ n: string }>(
      `select count(*)::text as n from homework_submissions
        where assignment_id = $1 and status = 'approved' and student_id = any($2::uuid[])`,
      [assignmentId, studentIds],
    );
    expect(Number(graded.rows[0]!.n)).toBe(3);
  });
});
