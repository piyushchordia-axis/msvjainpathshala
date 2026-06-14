import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

interface BatchRow {
  id: string;
  name: string | null;
  centre_name: string;
}

// The seeded GPS centre (see lib/db/src/seed.ts: "Ghatkopar Jain Pathshala").
const GPS_CENTRE_NAME = "Ghatkopar Jain Pathshala";
const GPS_CENTRE_LAT = 19.0861;
const GPS_CENTRE_LNG = 72.9081;

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
      .post(`/v1/attendance/sessions/${sessionId}/mark`)
      .set(auth(token))
      .send({ records });
    expect(marked.status).toBe(200);
    expect(marked.body.data.marked).toBe(records.length);
    expect(marked.body.data.method).toBe("manual");

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
      .post(`/v1/attendance/sessions/${sessionId}/mark`)
      .set(auth(token))
      .send({ records: [{ student_id: foreignStudentId, status: "present" }] });
    expect(res.status).toBe(422);
  });

  it("enforces the GPS geofence for gps_required sessions", async () => {
    const { token } = await loginAs("super_admin");
    const batches = await listBatches(token);
    const gpsBatch = batches.find((b) => b.centre_name === GPS_CENTRE_NAME);
    expect(gpsBatch, "expected a seeded batch at the GPS centre").toBeTruthy();

    // Create a gps_required session for the GPS centre's batch.
    const session = await request(app)
      .post("/v1/attendance/sessions")
      .set(auth(token))
      .send({ batch_id: gpsBatch!.id, session_date: "2026-01-17", gps_required: true });
    expect(session.status).toBe(200);
    const sessionId: string = session.body.data.id;

    const rosterRes = await request(app).get(`/v1/attendance/sessions/${sessionId}`).set(auth(token));
    expect(rosterRes.status).toBe(200);
    expect(rosterRes.body.data.session.has_gps).toBe(true);
    const roster = rosterRes.body.data.roster as Array<{ student_id: string }>;
    if (roster.length === 0) return;
    const records = [{ student_id: roster[0].student_id, status: "present" as const }];

    // Far-away coordinates -> 403 (outside geofence).
    const far = await request(app)
      .post(`/v1/attendance/sessions/${sessionId}/mark`)
      .set(auth(token))
      .send({ records, lat: 28.6139, lng: 77.209 }); // New Delhi, hundreds of km away
    expect(far.status).toBe(403);

    // Near coordinates (at the centre) -> 200.
    const near = await request(app)
      .post(`/v1/attendance/sessions/${sessionId}/mark`)
      .set(auth(token))
      .send({ records, lat: GPS_CENTRE_LAT, lng: GPS_CENTRE_LNG });
    expect(near.status).toBe(200);
    expect(near.body.data.method).toBe("gps");
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
});
