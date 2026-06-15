/**
 * Shivir scanner: super_admin creates a session under a seeded Mumbai shivir,
 * generates a signed ID card for a student, then records a QR scan (valid +
 * tampered signature), and reads the live dashboard counts.
 *
 * Self-creating + rerun-safe: a fresh session is created each run, and id-card
 * generate is an idempotent upsert (only bumps version), so re-running against a
 * non-reset DB never fails.
 *
 * Also covers the city-scope authz fix (an admin from a DIFFERENT city scanning a
 * Mumbai shivir session -> 404, no PII leak) and the attendance-mode validation
 * fix (a check_in scan against a present_only session -> 422). The cross-city
 * admin is self-created in another city and deleted afterwards.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool, db, cities, users } from "@workspace/db";
import { eq, ne } from "drizzle-orm";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end();
});

/** Log in by raw phone (for self-created users): registered users get dev_code. */
async function loginByPhone(phone: string): Promise<string> {
  const send = await request(app).post("/api/auth/login").send({ phase: "send", phone });
  expect(send.status).toBe(200);
  const otpToken: string = send.body.data.otp_token;
  const code: string = send.body.data.dev_code ?? "123456";
  const verify = await request(app)
    .post("/api/auth/login")
    .send({ phase: "verify", otp_token: otpToken, code, device_id: `test-${phone}` });
  expect(verify.status).toBe(200);
  return verify.body.data.tokens.access_token as string;
}

/** Resolve the Mumbai shivir's city_id and any OTHER city's id (for cross-city tests). */
async function mumbaiCityAndOtherCity(): Promise<{ mumbaiCityId: string; otherCityId: string }> {
  const [mumbaiCity] = await db
    .select({ id: cities.id })
    .from(cities)
    .where(eq(cities.name, "Mumbai"))
    .limit(1);
  expect(mumbaiCity).toBeTruthy();
  const [other] = await db
    .select({ id: cities.id })
    .from(cities)
    .where(ne(cities.id, mumbaiCity!.id))
    .limit(1);
  expect(other).toBeTruthy();
  return { mumbaiCityId: mumbaiCity!.id, otherCityId: other!.id };
}

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

  it("404s when an admin from a different city scans a Mumbai shivir session (no PII leak)", async () => {
    const admin = await loginAs("super_admin");
    const shivirId = await mumbaiShivirId(admin.token);

    // super_admin creates a session under the Mumbai shivir.
    const createSession = await request(app)
      .post(`/v1/shivir-scanner/shivirs/${shivirId}/sessions`)
      .set(auth(admin.token))
      .send({
        title: `Cross-city Session ${Date.now()}`,
        session_date: "2026-06-15",
        attendance_mode: "present_only",
      });
    expect(createSession.status).toBe(200);
    const sessionId: string = createSession.body.data.id;

    // Self-create a city_admin in a DIFFERENT (non-Mumbai) city, then log in.
    const { otherCityId } = await mumbaiCityAndOtherCity();
    const phone = `+9197${Date.now().toString().slice(-8)}`;
    const [outsider] = await db
      .insert(users)
      .values({
        phone,
        role: "city_admin",
        full_name: "Out-of-city Admin",
        preferred_language: "en",
        city_id: otherCityId,
      })
      .returning({ id: users.id });
    try {
      const token = await loginByPhone(phone);

      // Even with a (would-be) valid scan body, the out-of-city admin must not
      // be able to scan into the Mumbai shivir's session -> 404 (session hidden).
      const res = await request(app)
        .post(`/v1/shivir-scanner/sessions/${sessionId}/scan`)
        .set(auth(token))
        .send({
          qr_payload: '{"student_id":"00000000-0000-0000-0000-000000000000","card_number":"X","v":1}',
          qr_signature: "0".repeat(64),
          scan_kind: "present",
        });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("ERR_NOT_FOUND");
    } finally {
      // Clean up the self-created user so reruns against a non-reset DB are safe.
      await db.delete(users).where(eq(users.id, outsider.id));
    }
  });

  it("422s when scan_kind is incompatible with the session's attendance_mode", async () => {
    const admin = await loginAs("super_admin");
    const shivirId = await mumbaiShivirId(admin.token);
    const studentId = await firstStudentId(admin.token);

    // A present_only session must reject check_in / check_out.
    const createSession = await request(app)
      .post(`/v1/shivir-scanner/shivirs/${shivirId}/sessions`)
      .set(auth(admin.token))
      .send({
        title: `Mode Session ${Date.now()}`,
        session_date: "2026-06-15",
        attendance_mode: "present_only",
      });
    expect(createSession.status).toBe(200);
    const sessionId: string = createSession.body.data.id;

    // Use a real signed card so the only failing check is the scan_kind/mode rule.
    const gen = await request(app)
      .post(`/v1/id-cards/generate/${studentId}`)
      .set(auth(admin.token))
      .send({});
    expect(gen.status).toBe(200);
    const getCard = await request(app).get(`/v1/id-cards/${studentId}`).set(auth(admin.token));
    expect(getCard.status).toBe(200);
    const { qr_payload, qr_signature } = getCard.body.data as {
      qr_payload: string;
      qr_signature: string;
    };

    const res = await request(app)
      .post(`/v1/shivir-scanner/sessions/${sessionId}/scan`)
      .set(auth(admin.token))
      .send({ qr_payload, qr_signature, scan_kind: "check_in" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });
});
