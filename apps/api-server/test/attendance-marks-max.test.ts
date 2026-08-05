/**
 * PERF #4 — marks[] capped at 200. Online route + sync/batch both reject 201
 * with ERR_VALIDATION_FAILED and write zero attendance rows; 200 still passes
 * schema validation (not rejected as oversized).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import app from "../src/app";
import { pool, workerPool } from "@workspace/db";
import { loginAs, auth } from "./helpers";
import { ulid } from "../src/lib/ulid";

function fakeMarks(n: number) {
  return Array.from({ length: n }, () => ({
    student_id: randomUUID(),
    status: "present" as const,
    client_op_id: ulid(),
  }));
}

afterAll(async () => {
  await Promise.all([pool.end(), workerPool.end()]);
});

describe("attendance marks[] max (PERF #4)", () => {
  it("a roster submission above the mark limit is rejected with 422", async () => {
    const { token } = await loginAs("super_admin");
    await request(app).post("/v1/admin/sessions/materialise").set(auth(token)).send({});

    const today = await request(app).get("/v1/sessions/today").set(auth(token));
    expect(today.status).toBe(200);
    const items = today.body.data.items as Array<{
      id: string;
      scheduled_date: string;
      status: string;
    }>;
    const session = items.find((s) => s.status === "scheduled" || s.status === "in_progress");
    if (!session) return;

    const before = await pool.query(
      `select count(*)::int as c from attendance where session_id = $1`,
      [session.id],
    );
    const beforeCount = before.rows[0].c as number;

    const markedAt = `${session.scheduled_date}T10:00:00.000+05:30`;
    const res = await request(app)
      .post(`/v1/sessions/${session.id}/attendance`)
      .set(auth(token))
      .send({
        submission_op_id: ulid(),
        marked_at: markedAt,
        marks: fakeMarks(201),
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
    expect(res.body.error.message).toMatch(/more than 200 marks/i);

    const after = await pool.query(
      `select count(*)::int as c from attendance where session_id = $1`,
      [session.id],
    );
    expect(after.rows[0].c).toBe(beforeCount);
  });

  it("a 200-mark submission still succeeds past validation", async () => {
    const { token } = await loginAs("super_admin");
    await request(app).post("/v1/admin/sessions/materialise").set(auth(token)).send({});

    const today = await request(app).get("/v1/sessions/today").set(auth(token));
    const items = today.body.data.items as Array<{
      id: string;
      scheduled_date: string;
      status: string;
    }>;
    const session = items.find((s) => s.status === "scheduled" || s.status === "in_progress");
    if (!session) return;

    const markedAt = `${session.scheduled_date}T10:00:00.000+05:30`;
    const res = await request(app)
      .post(`/v1/sessions/${session.id}/attendance`)
      .set(auth(token))
      .send({
        submission_op_id: ulid(),
        marked_at: markedAt,
        marks: fakeMarks(200),
      });

    // Must not be rejected as oversized — enrolment rejects are per-item (200 OK).
    expect(res.status).not.toBe(422);
    expect(res.status).toBe(200);
    expect(res.body.data.rejected + res.body.data.applied + res.body.data.duplicate).toBe(200);
  });

  it("sync/batch rejects an oversized marks array without writing rows", async () => {
    const { token } = await loginAs("super_admin");
    await request(app).post("/v1/admin/sessions/materialise").set(auth(token)).send({});

    const today = await request(app).get("/v1/sessions/today").set(auth(token));
    const items = today.body.data.items as Array<{
      id: string;
      scheduled_date: string;
      status: string;
      batch_id?: string;
      roster?: Array<{ student_id: string }>;
    }>;
    const session = items.find(
      (s) => (s.status === "scheduled" || s.status === "in_progress") && (s.roster?.length ?? 0) > 0,
    );
    if (!session) return;

    // Resolve batch_id from DB (today payload may omit it).
    const sessRow = await pool.query(`select batch_id from sessions where id = $1`, [session.id]);
    const batchId = sessRow.rows[0].batch_id as string;

    const before = await pool.query(
      `select count(*)::int as c from attendance where session_id = $1`,
      [session.id],
    );
    const beforeCount = before.rows[0].c as number;

    const res = await request(app)
      .post("/v1/sync/batch")
      .set(auth(token))
      .send({
        ops: [
          {
            submission_op_id: ulid(),
            op_type: "attendance",
            payload: {
              batch_id: batchId,
              session_date: session.scheduled_date,
              marked_at: `${session.scheduled_date}T10:00:00.000+05:30`,
              marks: fakeMarks(201),
            },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });

    expect(res.status).toBe(200);
    const result = res.body.data.results[0];
    expect(result.status).toBe("failed");
    expect(result.error.code).toBe("ERR_VALIDATION_FAILED");
    expect(result.error.message).toMatch(/more than 200 marks/i);

    const after = await pool.query(
      `select count(*)::int as c from attendance where session_id = $1`,
      [session.id],
    );
    expect(after.rows[0].c).toBe(beforeCount);
  });

  it("sync/batch accepts a 200-mark attendance op past validation", async () => {
    const { token } = await loginAs("super_admin");
    await request(app).post("/v1/admin/sessions/materialise").set(auth(token)).send({});

    const today = await request(app).get("/v1/sessions/today").set(auth(token));
    const items = today.body.data.items as Array<{
      id: string;
      scheduled_date: string;
      status: string;
    }>;
    const session = items.find((s) => s.status === "scheduled" || s.status === "in_progress");
    if (!session) return;

    const sessRow = await pool.query(`select batch_id from sessions where id = $1`, [session.id]);
    const batchId = sessRow.rows[0].batch_id as string;

    const res = await request(app)
      .post("/v1/sync/batch")
      .set(auth(token))
      .send({
        ops: [
          {
            submission_op_id: ulid(),
            op_type: "attendance",
            payload: {
              batch_id: batchId,
              session_date: session.scheduled_date,
              marked_at: `${session.scheduled_date}T10:00:00.000+05:30`,
              marks: fakeMarks(200),
            },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });

    expect(res.status).toBe(200);
    const result = res.body.data.results[0];
    // Not a validation failure — domain may reject unenrolled students per-item.
    expect(result.error?.code).not.toBe("ERR_VALIDATION_FAILED");
    expect(result.status).not.toBe("failed");
  });
});
