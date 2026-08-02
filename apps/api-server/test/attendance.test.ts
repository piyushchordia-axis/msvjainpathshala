import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";
import { ulid } from "../src/lib/ulid";

function markBody(
  records: Array<{ student_id: string; status: "present" | "absent" | "late" | "excused" }>,
  markedAt = new Date().toISOString(),
) {
  return {
    submission_op_id: ulid(),
    marked_at: markedAt,
    marks: records.map((r) => ({ ...r, client_op_id: ulid() })),
  };
}

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

interface BatchRow {
  id: string;
  name: string | null;
  centre_name: string;
}

async function listBatches(token: string): Promise<BatchRow[]> {
  const res = await request(app).get("/v1/admin/batches").set(auth(token));
  expect(res.status).toBe(200);
  return res.body.data.items as BatchRow[];
}

describe("attendance", () => {
  it("rejects unauthenticated access", async () => {
    const res = await request(app).get("/v1/attendance/sessions");
    expect(res.status).toBe(401);
  });

  it("creates a session, marks manual attendance, and persists statuses", async () => {
    const { token } = await loginAs("super_admin");
    const batches = await listBatches(token);
    expect(batches.length).toBeGreaterThan(0);
    const batch = batches[0];

    // Create a session for that batch.
    const created = await request(app)
      .post("/v1/attendance/sessions")
      .set(auth(token))
      .send({ batch_id: batch.id, session_date: "2026-01-15", topic: "Test session" });
    expect(created.status).toBe(200);
    const sessionId: string = created.body.data.id;
    expect(sessionId).toBeTruthy();

    // Fetch the roster.
    const rosterRes = await request(app).get(`/v1/attendance/sessions/${sessionId}`).set(auth(token));
    expect(rosterRes.status).toBe(200);
    const roster = rosterRes.body.data.roster as Array<{ student_id: string; status: string | null }>;

    if (roster.length === 0) {
      // No active students in this batch — nothing to mark; the mark endpoint
      // requires a non-empty records array, so we stop here gracefully.
      return;
    }

    // Mark each student: first present, then flip the first one to absent.
    const records = roster.map((r, i) => ({
      student_id: r.student_id,
      status: i === 0 ? ("absent" as const) : ("present" as const),
    }));
    const marked = await request(app)
      .post(`/v1/sessions/${sessionId}/attendance`)
      .set(auth(token))
      .send(markBody(records, "2026-01-15T10:00:00.000+05:30"));
    expect(marked.status).toBe(200);
    expect(marked.body.data.applied).toBe(records.length);

    // Re-fetch the roster and assert statuses persisted.
    const reRes = await request(app).get(`/v1/attendance/sessions/${sessionId}`).set(auth(token));
    expect(reRes.status).toBe(200);
    expect(reRes.body.data.session.status).toBe("completed");
    const reRoster = reRes.body.data.roster as Array<{ student_id: string; status: string | null }>;
    const byId = new Map(reRoster.map((r) => [r.student_id, r.status]));
    expect(byId.get(records[0].student_id)).toBe("absent");
    if (records.length > 1) {
      expect(byId.get(records[1].student_id)).toBe("present");
    }
  });

  it("rejects students that do not belong to the session's batch", async () => {
    const { token } = await loginAs("super_admin");
    const batches = await listBatches(token);
    expect(batches.length).toBeGreaterThan(1);

    const session = await request(app)
      .post("/v1/attendance/sessions")
      .set(auth(token))
      .send({ batch_id: batches[0].id, session_date: "2026-01-16" });
    expect(session.status).toBe(200);
    const sessionId: string = session.body.data.id;

    // Find a student from a *different* batch (out-of-batch foreign student).
    let foreignStudentId: string | null = null;
    for (let i = 1; i < batches.length; i++) {
      const otherSession = await request(app)
        .post("/v1/attendance/sessions")
        .set(auth(token))
        .send({ batch_id: batches[i].id, session_date: "2026-01-16" });
      const otherRoster = await request(app)
        .get(`/v1/attendance/sessions/${otherSession.body.data.id}`)
        .set(auth(token));
      const r = otherRoster.body.data.roster as Array<{ student_id: string }>;
      if (r.length > 0) {
        foreignStudentId = r[0].student_id;
        break;
      }
    }

    if (!foreignStudentId) return; // no foreign student available to assert with

    const res = await request(app)
      .post(`/v1/sessions/${sessionId}/attendance`)
      .set(auth(token))
      .send(markBody([{ student_id: foreignStudentId, status: "present" }], "2026-01-16T10:00:00.000+05:30"));
    expect(res.status).toBe(200);
    expect(res.body.data.rejected).toBe(1);
    expect(res.body.data.items[0].code).toBe("ERR_STUDENT_NOT_ENROLLED");
  });

  it.skip("GPS geofence moves to check-in (AT14); not on attendance mark", async () => {
    // Covered by future POST /v1/sessions/:id/check-in tests.
  });

  it("cancels a session", async () => {
    const { token } = await loginAs("super_admin");
    const batches = await listBatches(token);
    const session = await request(app)
      .post("/v1/attendance/sessions")
      .set(auth(token))
      .send({ batch_id: batches[0].id, session_date: "2026-01-18" });
    expect(session.status).toBe(200);
    const sessionId: string = session.body.data.id;

    const res = await request(app)
      .post(`/v1/attendance/sessions/${sessionId}/cancel`)
      .set(auth(token))
      .send({ reason: "Holiday" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("cancelled");
  });

  it("refuses to mark a cancelled session and leaves it cancelled", async () => {
    const { token } = await loginAs("super_admin");
    const batches = await listBatches(token);
    const session = await request(app)
      .post("/v1/attendance/sessions")
      .set(auth(token))
      .send({ batch_id: batches[0].id, session_date: "2026-01-19" });
    expect(session.status).toBe(200);
    const sessionId: string = session.body.data.id;

    // Cancel it first.
    const cancel = await request(app)
      .post(`/v1/attendance/sessions/${sessionId}/cancel`)
      .set(auth(token))
      .send({ reason: "Holiday" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe("cancelled");

    // Grab a real roster student id so the records array is well-formed; the
    // cancelled-guard must reject BEFORE any per-record validation/write.
    const rosterRes = await request(app).get(`/v1/attendance/sessions/${sessionId}`).set(auth(token));
    expect(rosterRes.status).toBe(200);
    const roster = rosterRes.body.data.roster as Array<{ student_id: string }>;
    const records =
      roster.length > 0
        ? [{ student_id: roster[0].student_id, status: "present" as const }]
        : // Fallback: a syntactically-valid (random uuid) record still must be
          // rejected by the cancelled guard, which runs before student checks.
          [{ student_id: "00000000-0000-0000-0000-000000000001", status: "present" as const }];

    const marked = await request(app)
      .post(`/v1/sessions/${sessionId}/attendance`)
      .set(auth(token))
      .send(markBody(records, "2026-01-19T10:00:00.000+05:30"));
    expect(marked.status).toBe(409);
    expect(marked.body.error.code).toBe("ERR_SESSION_CANCELLED");

    // The session must STILL be cancelled (not flipped to completed).
    const after = await request(app).get(`/v1/attendance/sessions/${sessionId}`).set(auth(token));
    expect(after.status).toBe(200);
    expect(after.body.data.session.status).toBe("cancelled");
  });

  it("marks via POST /v1/sessions/:id/attendance and persists status", async () => {
    const { token } = await loginAs("super_admin");
    const batches = await listBatches(token);
    const session = await request(app)
      .post("/v1/attendance/sessions")
      .set(auth(token))
      .send({ batch_id: batches[0].id, session_date: "2026-01-20" });
    expect(session.status).toBe(200);
    const sessionId: string = session.body.data.id;

    const rosterRes = await request(app).get(`/v1/attendance/sessions/${sessionId}`).set(auth(token));
    expect(rosterRes.status).toBe(200);
    const roster = rosterRes.body.data.roster as Array<{ student_id: string }>;
    if (roster.length === 0) return;
    const records = [{ student_id: roster[0].student_id, status: "present" as const }];

    const marked = await request(app)
      .post(`/v1/sessions/${sessionId}/attendance`)
      .set(auth(token))
      .send(markBody(records, "2026-01-20T10:00:00.000+05:30"));
    expect(marked.status).toBe(200);
    expect(marked.body.data.applied).toBe(1);

    const reRes = await request(app).get(`/v1/attendance/sessions/${sessionId}`).set(auth(token));
    expect(reRes.status).toBe(200);
    const reRoster = reRes.body.data.roster as Array<{
      student_id: string;
      status: string | null;
    }>;
    const row = reRoster.find((r) => r.student_id === records[0].student_id);
    expect(row?.status).toBe("present");
  });

  it("returns 404 when city_admin reads an out-of-scope session", async () => {
    // city_admin (+919800000003) is scoped to Mumbai; Kothrud (Pune) and
    // Maninagar (Ahmedabad) centres are OUTSIDE that scope.
    const { token: superToken } = await loginAs("super_admin");
    const { token: cityToken } = await loginAs("city_admin");

    const allBatches = await listBatches(superToken);
    const cityBatches = await listBatches(cityToken);
    const cityCentreNames = new Set(cityBatches.map((b) => b.centre_name));

    // Pick a batch whose centre is NOT visible to the city_admin (out of scope).
    const outOfScopeBatch = allBatches.find((b) => !cityCentreNames.has(b.centre_name));

    if (outOfScopeBatch) {
      const session = await request(app)
        .post("/v1/attendance/sessions")
        .set(auth(superToken))
        .send({ batch_id: outOfScopeBatch.id, session_date: "2026-01-21" });
      expect(session.status).toBe(200);
      const sessionId: string = session.body.data.id;

      // super_admin can read it...
      const asSuper = await request(app)
        .get(`/v1/attendance/sessions/${sessionId}`)
        .set(auth(superToken));
      expect(asSuper.status).toBe(200);

      // ...but the city_admin (out of scope) gets 404, not the session.
      const asCity = await request(app)
        .get(`/v1/attendance/sessions/${sessionId}`)
        .set(auth(cityToken));
      expect(asCity.status).toBe(404);
    }

    // Backstop: a random non-existent uuid is always 404 for the city_admin.
    const missing = await request(app)
      .get("/v1/attendance/sessions/00000000-0000-0000-0000-0000000000ff")
      .set(auth(cityToken));
    expect(missing.status).toBe(404);
  });
});
