import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

/**
 * Self-creating + rerun-safe: super_admin sees all centres, so we just pick an
 * existing student from GET /v1/admin/students (any student in scope works) and
 * generate a fresh card for them. Generate is an upsert, so re-running the test
 * against a non-reset DB only bumps the version — never fails.
 */
async function firstStudentId(adminToken: string): Promise<string> {
  const res = await request(app).get("/v1/admin/students?limit=1").set(auth(adminToken));
  expect(res.status).toBe(200);
  const student = res.body.data.items[0];
  expect(student).toBeTruthy();
  return student.id as string;
}

describe("id-cards", () => {
  it("requires auth on verify", async () => {
    const res = await request(app).post("/v1/id-cards/verify").send({});
    expect(res.status).toBe(401);
  });

  it("requires admin panel on generate", async () => {
    const { token } = await loginAs("parent");
    const studentId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app).post(`/v1/id-cards/generate/${studentId}`).set(auth(token)).send({});
    expect(res.status).toBe(403);
  });

  it("generates a card, reads it back, and verifies the signed QR (valid + tampered)", async () => {
    const admin = await loginAs("super_admin");
    const studentId = await firstStudentId(admin.token);

    // Generate / regenerate.
    const gen = await request(app)
      .post(`/v1/id-cards/generate/${studentId}`)
      .set(auth(admin.token))
      .send({});
    expect(gen.status).toBe(200);
    expect(gen.body.data.student_id).toBe(studentId);
    expect(typeof gen.body.data.card_number).toBe("string");
    expect(gen.body.data.card_number.length).toBeGreaterThan(0);
    expect(typeof gen.body.data.png_url).toBe("string");
    expect(gen.body.data.png_url).toContain("/uploads/");
    expect(gen.body.data.version_no).toBeGreaterThanOrEqual(1);

    // Admin reads the card back.
    const get = await request(app).get(`/v1/id-cards/${studentId}`).set(auth(admin.token));
    expect(get.status).toBe(200);
    expect(get.body.data.student_id).toBe(studentId);
    expect(get.body.data.card_number).toBe(gen.body.data.card_number);
    expect(typeof get.body.data.qr_payload).toBe("string");
    expect(typeof get.body.data.qr_signature).toBe("string");

    const { qr_payload, qr_signature } = get.body.data;

    // Verify with the real signature -> valid.
    const verify = await request(app)
      .post("/v1/id-cards/verify")
      .set(auth(admin.token))
      .send({ qr_payload, qr_signature });
    expect(verify.status).toBe(200);
    expect(verify.body.data.valid).toBe(true);
    expect(verify.body.data.student.id).toBe(studentId);
    expect(typeof verify.body.data.student.student_code).toBe("string");

    // Tampered signature -> 401 ERR_SIGNATURE_INVALID.
    const tampered =
      qr_signature.slice(0, -1) + (qr_signature.slice(-1) === "a" ? "b" : "a");
    const bad = await request(app)
      .post("/v1/id-cards/verify")
      .set(auth(admin.token))
      .send({ qr_payload, qr_signature: tampered });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("ERR_SIGNATURE_INVALID");

    // Tampered payload (signature no longer matches) -> 401.
    const tamperedPayload = await request(app)
      .post("/v1/id-cards/verify")
      .set(auth(admin.token))
      .send({ qr_payload: qr_payload + " ", qr_signature });
    expect(tamperedPayload.status).toBe(401);
    expect(tamperedPayload.body.error.code).toBe("ERR_SIGNATURE_INVALID");
  });

  it("returns 404 for a card that does not exist in scope", async () => {
    const admin = await loginAs("super_admin");
    const missing = "11111111-1111-1111-1111-111111111111";
    const res = await request(app).get(`/v1/id-cards/${missing}`).set(auth(admin.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ERR_NOT_FOUND");
  });
});
