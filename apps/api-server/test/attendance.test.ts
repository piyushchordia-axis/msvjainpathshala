/**
 * Frozen-route attendance HTTP tests (no /v1/attendance/* aliases).
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";
import { ulid } from "../src/lib/ulid";

function markBody(
  records: Array<{ student_id: string; status: "present" | "absent" | "late" | "excused" }>,
  markedAt: string,
) {
  return {
    submission_op_id: ulid(),
    marked_at: markedAt,
    marks: records.map((r) => ({ ...r, client_op_id: ulid() })),
  };
}

afterAll(async () => {
  await pool.end();
});

describe("attendance (frozen routes)", () => {
  it("rejects unauthenticated access to /v1/sessions/today", async () => {
    const res = await request(app).get("/v1/sessions/today");
    expect(res.status).toBe(401);
  });

  it("GET /v1/sessions/today returns scoped items for shikshak", async () => {
    const { token } = await loginAs("shikshak");
    const res = await request(app).get("/v1/sessions/today").set(auth(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it("marks via POST /v1/sessions/:id/attendance and cancels via /cancel", async () => {
    const { token } = await loginAs("super_admin");

    // Materialise rolling window so today has sessions.
    await request(app).post("/v1/admin/sessions/materialise").set(auth(token)).send({});

    const today = await request(app).get("/v1/sessions/today").set(auth(token));
    expect(today.status).toBe(200);
    const listItems = today.body.data.items as Array<{
      id: string;
      scheduled_date: string;
      status: string;
      centre_id?: string;
    }>;
    const candidate = listItems.find(
      (s) => s.status === "scheduled" || s.status === "in_progress",
    );
    if (!candidate) return;

    // Broad /today omits roster — fetch one session with roster via session_id.
    const detail = await request(app)
      .get("/v1/sessions/today")
      .query({ session_id: candidate.id })
      .set(auth(token));
    expect(detail.status).toBe(200);
    const session = (detail.body.data.items as Array<{
      id: string;
      scheduled_date: string;
      status: string;
      roster: Array<{ student_id: string; status: string | null }>;
    }>)[0];
    if (!session || !(session.roster?.length ?? 0)) return;

    const roster = session.roster ?? [];
    const markedAt = `${session.scheduled_date}T10:00:00.000+05:30`;
    const records = roster.slice(0, Math.min(5, roster.length)).map((r, i) => ({
      student_id: r.student_id,
      status: (i === 0 ? "absent" : "present") as "absent" | "present",
    }));

    const marked = await request(app)
      .post(`/v1/sessions/${session.id}/attendance`)
      .set(auth(token))
      .send(markBody(records, markedAt));
    expect(marked.status).toBe(200);
    expect(marked.body.data.applied).toBeGreaterThan(0);

    const cancelled = await request(app)
      .post(`/v1/sessions/${session.id}/cancel`)
      .set(auth(token))
      .send({ reason: "Test cancellation for frozen route coverage.", force_cancel: true });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("cancelled");
  });

  it("refuses to mark a cancelled session (409)", async () => {
    const { token } = await loginAs("super_admin");
    await request(app).post("/v1/admin/sessions/materialise").set(auth(token)).send({});
    const today = await request(app).get("/v1/sessions/today").set(auth(token));
    const listItems = today.body.data.items as Array<{
      id: string;
      status: string;
    }>;
    const candidate = listItems.find((s) => s.status === "scheduled" || s.status === "in_progress");
    if (!candidate) return;

    const detail = await request(app)
      .get("/v1/sessions/today")
      .query({ session_id: candidate.id })
      .set(auth(token));
    const session = (detail.body.data.items as Array<{
      id: string;
      scheduled_date: string;
      roster: Array<{ student_id: string }>;
      status: string;
    }>)[0];
    if (!session || !session.roster?.length) return;

    await request(app)
      .post(`/v1/sessions/${session.id}/cancel`)
      .set(auth(token))
      .send({ reason: "Cancel before mark for AT24 coverage test." });

    const marked = await request(app)
      .post(`/v1/sessions/${session.id}/attendance`)
      .set(auth(token))
      .send(
        markBody(
          [{ student_id: session.roster[0]!.student_id, status: "present" }],
          `${session.scheduled_date}T10:00:00.000+05:30`,
        ),
      );
    expect(marked.status).toBe(409);
    expect(marked.body.error.code).toBe("ERR_SESSION_CANCELLED");
  });

  it("GET /v1/centres/:id/holidays is public (published only)", async () => {
    const { token } = await loginAs("super_admin");
    const centres = await request(app).get("/v1/admin/centres").set(auth(token));
    expect(centres.status).toBe(200);
    const centreId = centres.body.data.items[0]?.id as string | undefined;
    if (!centreId) return;

    const pub = await request(app).get(`/v1/centres/${centreId}/holidays`);
    expect(pub.status).toBe(200);
    expect(Array.isArray(pub.body.data.items)).toBe(true);
  });

  it("GET /v1/admin/centres/:id/holidays forbids shikshak", async () => {
    const admin = await loginAs("super_admin");
    const centres = await request(app).get("/v1/admin/centres").set(auth(admin.token));
    const centreId = centres.body.data.items[0]?.id as string | undefined;
    if (!centreId) return;

    const shikshak = await loginAs("shikshak");
    const res = await request(app)
      .get(`/v1/admin/centres/${centreId}/holidays`)
      .set(auth(shikshak.token));
    expect(res.status).toBe(403);
  });
});
