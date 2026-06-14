/**
 * Shivir scanner: super_admin creates a session under a seeded Mumbai shivir,
 * generates a signed ID card for a student, then records a QR scan (valid +
 * tampered signature), and reads the live dashboard counts.
 *
 * Self-creating + rerun-safe: a fresh session is created each run, and id-card
 * generate is an idempotent upsert (only bumps version), so re-running against a
 * non-reset DB never fails.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end();
});

/** A seeded shivir in Mumbai, via the existing admin shivirs list. */
async function mumbaiShivirId(token: string): Promise<string> {
  const res = await request(app).get("/v1/admin/shivirs?limit=200").set(auth(token));
  expect(res.status).toBe(200);
  const items: Array<{ id: string; city_name: string }> = res.body.data.items;
  const mumbai = items.find((s) => s.city_name === "Mumbai");
  expect(mumbai).toBeDefined();
  return mumbai!.id;
}

/** The first student in scope (super_admin sees all). */
async function firstStudentId(token: string): Promise<string> {
  const res = await request(app).get("/v1/admin/students?limit=1").set(auth(token));
  expect(res.status).toBe(200);
  const student = res.body.data.items[0];
  expect(student).toBeTruthy();
  return student.id as string;
}

describe("shivir scanner", () => {
  it("requires auth on scan", async () => {
    const res = await request(app)
      .post("/v1/shivir-scanner/sessions/00000000-0000-0000-0000-000000000000/scan")
      .send({});
    expect(res.status).toBe(401);
  });

  it("requires admin panel to create a session", async () => {
    const { token } = await loginAs("parent");
    const res = await request(app)
      .post("/v1/shivir-scanner/shivirs/00000000-0000-0000-0000-000000000000/sessions")
      .set(auth(token))
      .send({ title: "x", session_date: "2026-06-15" });
    expect(res.status).toBe(403);
  });

  it("creates a session, scans a valid QR, rejects a tampered one, and shows live counts", async () => {
    const admin = await loginAs("super_admin");
    const shivirId = await mumbaiShivirId(admin.token);
    const studentId = await firstStudentId(admin.token);

    // Create a session under the seeded Mumbai shivir.
    const createSession = await request(app)
      .post(`/v1/shivir-scanner/shivirs/${shivirId}/sessions`)
      .set(auth(admin.token))
      .send({
        title: `Vitest Session ${Date.now()}`,
        session_date: "2026-06-15",
        attendance_mode: "present_only",
      });
    expect(createSession.status).toBe(200);
    const sessionId: string = createSession.body.data.id;
    expect(sessionId).toBeTruthy();

    // The session shows up in the list.
    const listSessions = await request(app)
      .get(`/v1/shivir-scanner/shivirs/${shivirId}/sessions`)
      .set(auth(admin.token));
    expect(listSessions.status).toBe(200);
    expect(
      (listSessions.body.data.items as Array<{ id: string }>).some((s) => s.id === sessionId),
    ).toBe(true);

    // Generate a card for the student, then read its signed QR.
    const gen = await request(app)
      .post(`/v1/id-cards/generate/${studentId}`)
      .set(auth(admin.token))
      .send({});
    expect(gen.status).toBe(200);
    const getCard = await request(app)
      .get(`/v1/id-cards/${studentId}`)
      .set(auth(admin.token));
    expect(getCard.status).toBe(200);
    const { qr_payload, qr_signature } = getCard.body.data as {
      qr_payload: string;
      qr_signature: string;
    };

    // Scan with the real signature -> 200, records the scan.
    const scan = await request(app)
      .post(`/v1/shivir-scanner/sessions/${sessionId}/scan`)
      .set(auth(admin.token))
      .send({ qr_payload, qr_signature, scan_kind: "present" });
    expect(scan.status).toBe(200);
    expect(scan.body.data.student.id).toBe(studentId);
    expect(scan.body.data.scan_kind).toBe("present");
    expect(typeof scan.body.data.student.student_code).toBe("string");

    // Scan with a tampered signature -> 401.
    const tampered =
      qr_signature.slice(0, -1) + (qr_signature.slice(-1) === "a" ? "b" : "a");
    const badScan = await request(app)
      .post(`/v1/shivir-scanner/sessions/${sessionId}/scan`)
      .set(auth(admin.token))
      .send({ qr_payload, qr_signature: tampered });
    expect(badScan.status).toBe(401);
    expect(badScan.body.error.code).toBe("ERR_SIGNATURE_INVALID");

    // Dashboard shows the live counts for this session (>= 1 distinct student).
    const dash = await request(app)
      .get(`/v1/shivir-scanner/shivirs/${shivirId}/dashboard`)
      .set(auth(admin.token));
    expect(dash.status).toBe(200);
    const sessions: Array<{
      id: string;
      present: number;
      distinct_students: number;
    }> = dash.body.data.sessions;
    const row = sessions.find((s) => s.id === sessionId);
    expect(row).toBeDefined();
    expect(row!.distinct_students).toBeGreaterThanOrEqual(1);
    expect(row!.present).toBeGreaterThanOrEqual(1);
    expect(typeof dash.body.data.registered_total).toBe("number");
  });

  it("returns 404 for a shivir out of scope / nonexistent", async () => {
    const admin = await loginAs("super_admin");
    const res = await request(app)
      .get("/v1/shivir-scanner/shivirs/11111111-1111-1111-1111-111111111111/dashboard")
      .set(auth(admin.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ERR_NOT_FOUND");
  });
});
