/**
 * PERF #12 — generate-all returns 202 and enqueues chunked jobs; no render on request path.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";
import * as queues from "../src/lib/queues";
import * as idcardRender from "../src/lib/idcard-render";
import {
  IDCARD_CHUNK_SIZE,
  processIdCardGenerationChunk,
  registerIdCardJobs,
} from "../src/jobs/idcard-jobs";
import { registerIdCardBulkBatch, getIdCardBulkBatch } from "../src/lib/idcard-bulk-progress";
import { ulid } from "../src/lib/ulid";

registerIdCardJobs();

beforeEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

describe("PERF #12 id-cards generate-all", () => {
  it("generate-all returns 202 immediately and enqueues one job per chunk", async () => {
    const admin = await loginAs("super_admin");
    const enqueueSpy = vi.spyOn(queues, "enqueueJob").mockResolvedValue(undefined);
    const renderSpy = vi.spyOn(idcardRender, "upsertIdCardArt");

    const countRes = await pool.query<{ n: string }>(
      `select count(*)::text as n from students
        where deleted_at is null and status = 'active'`,
    );
    const total = Number(countRes.rows[0]!.n);
    const expectedJobs = Math.ceil(total / IDCARD_CHUNK_SIZE) || 0;

    const t0 = Date.now();
    const res = await request(app)
      .post("/v1/id-cards/generate-all")
      .set(auth(admin.token))
      .send({ only_missing: false });
    const elapsed = Date.now() - t0;

    expect(res.status).toBe(202);
    expect(res.body.data.batch_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i);
    expect(res.body.data.job_count).toBe(expectedJobs);
    expect(res.body.data.total_students).toBe(total);
    expect(elapsed).toBeLessThan(2000);

    const idcardJobs = enqueueSpy.mock.calls.filter((c) => c[0] === "idcard.generation");
    expect(idcardJobs.length).toBe(expectedJobs);
    if (expectedJobs > 0) {
      const first = idcardJobs[0]![1] as { student_ids: string[]; batch_id: string };
      expect(first.student_ids.length).toBeLessThanOrEqual(IDCARD_CHUNK_SIZE);
      expect(first.batch_id).toBe(res.body.data.batch_id);
    }
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("generate-all does not render any image in the request path", async () => {
    const admin = await loginAs("super_admin");
    vi.spyOn(queues, "enqueueJob").mockResolvedValue(undefined);
    const renderSpy = vi.spyOn(idcardRender, "upsertIdCardArt").mockResolvedValue({
      student_id: "x",
      card_number: "x",
      png_url: null,
      version_no: 1,
      is_active: true,
    } as Awaited<ReturnType<typeof idcardRender.upsertIdCardArt>>);

    await request(app)
      .post("/v1/id-cards/generate-all")
      .set(auth(admin.token))
      .send({});

    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("a job failure does not lose the remaining students", async () => {
    const centre = await pool.query<{ id: string }>(
      `select id from centres where deleted_at is null limit 1`,
    );
    expect(centre.rows.length).toBe(1);
    const centreId = centre.rows[0]!.id;

    const a = await pool.query<{ id: string }>(
      `insert into students (centre_id, full_name, student_code, status, dob, gender, age_group)
       values ($1, 'Perf12 A', $2, 'active', '2015-01-01', 'male', 'bal')
       returning id`,
      [centreId, `P12A${Date.now()}`],
    );
    const b = await pool.query<{ id: string }>(
      `insert into students (centre_id, full_name, student_code, status, dob, gender, age_group)
       values ($1, 'Perf12 B', $2, 'active', '2015-01-01', 'male', 'bal')
       returning id`,
      [centreId, `P12B${Date.now()}`],
    );
    const idA = a.rows[0]!.id;
    const idB = b.rows[0]!.id;

    const batchId = ulid();
    registerIdCardBulkBatch({
      batch_id: batchId,
      total_students: 2,
      job_count: 2,
      only_missing: false,
      started_at: new Date().toISOString(),
      student_ids: [idA, idB],
      jobs_completed: 0,
      jobs_failed: 0,
      students_generated: 0,
      students_skipped: 0,
      students_failed: 0,
    });

    vi.spyOn(idcardRender, "upsertIdCardArt").mockImplementation(async (opts) => {
      if (opts.studentId === idA) throw new Error("chunk A render boom");
      return {
        student_id: opts.studentId,
        card_number: `C-${opts.studentId.slice(0, 8)}`,
        png_url: "/uploads/id-cards/perf12.png",
        version_no: 1,
        is_active: true,
      } as Awaited<ReturnType<typeof idcardRender.upsertIdCardArt>>;
    });

    // Independent chunks — A fails its only student; B still succeeds.
    const r1 = await processIdCardGenerationChunk({
      batch_id: batchId,
      student_ids: [idA],
      only_missing: false,
    });
    const r2 = await processIdCardGenerationChunk({
      batch_id: batchId,
      student_ids: [idB],
      only_missing: false,
    });

    expect(r1.failed).toBe(1);
    expect(r1.generated).toBe(0);
    expect(r2.generated).toBe(1);
    expect(r2.failed).toBe(0);

    const batch = getIdCardBulkBatch(batchId)!;
    expect(batch.jobs_completed).toBe(2);
    expect(batch.students_generated).toBe(1);
    expect(batch.students_failed).toBe(1);

    await pool.query(`delete from students where id = any($1::uuid[])`, [[idA, idB]]);
  });
});
