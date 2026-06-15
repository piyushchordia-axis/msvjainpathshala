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

  it("rejects a stale (regenerated) QR: v1 signature no longer verifies after v2", async () => {
    const admin = await loginAs("super_admin");
    const studentId = await firstStudentId(admin.token);

    // Generate a card, then read back the current (v1 or later) signed QR.
    const genV1 = await request(app)
      .post(`/v1/id-cards/generate/${studentId}`)
      .set(auth(admin.token))
      .send({});
    expect(genV1.status).toBe(200);
    const v1VersionNo = genV1.body.data.version_no as number;

    const getV1 = await request(app).get(`/v1/id-cards/${studentId}`).set(auth(admin.token));
    expect(getV1.status).toBe(200);
    expect(getV1.body.data.version_no).toBe(v1VersionNo);
    const v1Payload = getV1.body.data.qr_payload as string;
    const v1Signature = getV1.body.data.qr_signature as string;

    // The v1 QR verifies right now (authentic + current).
    const verifyV1 = await request(app)
      .post("/v1/id-cards/verify")
      .set(auth(admin.token))
      .send({ qr_payload: v1Payload, qr_signature: v1Signature });
    expect(verifyV1.status).toBe(200);
    expect(verifyV1.body.data.valid).toBe(true);

    // Regenerate -> bumps version_no (now stale-old v1 QR points at a prior version).
    const genV2 = await request(app)
      .post(`/v1/id-cards/generate/${studentId}`)
      .set(auth(admin.token))
      .send({});
    expect(genV2.status).toBe(200);
    expect(genV2.body.data.version_no).toBe(v1VersionNo + 1);

    // The OLD v1 QR (authentic signature, but stale version) must now be rejected.
    const verifyStale = await request(app)
      .post("/v1/id-cards/verify")
      .set(auth(admin.token))
      .send({ qr_payload: v1Payload, qr_signature: v1Signature });
    expect(verifyStale.status).toBe(401);
    expect(verifyStale.body.error.code).toBe("ERR_SIGNATURE_INVALID");

    // The fresh v2 QR still verifies.
    const getV2 = await request(app).get(`/v1/id-cards/${studentId}`).set(auth(admin.token));
    expect(getV2.status).toBe(200);
    const verifyV2 = await request(app)
      .post("/v1/id-cards/verify")
      .set(auth(admin.token))
      .send({ qr_payload: getV2.body.data.qr_payload, qr_signature: getV2.body.data.qr_signature });
    expect(verifyV2.status).toBe(200);
    expect(verifyV2.body.data.valid).toBe(true);
  });

  it("rejects a signature with junk appended (non-canonical hex)", async () => {
    const admin = await loginAs("super_admin");
    const studentId = await firstStudentId(admin.token);

    await request(app).post(`/v1/id-cards/generate/${studentId}`).set(auth(admin.token)).send({});
    const get = await request(app).get(`/v1/id-cards/${studentId}`).set(auth(admin.token));
    expect(get.status).toBe(200);
    const { qr_payload, qr_signature } = get.body.data;

    // Valid signature with trailing junk -> rejected (Buffer.from hex truncation guard).
    const junk = await request(app)
      .post("/v1/id-cards/verify")
      .set(auth(admin.token))
      .send({ qr_payload, qr_signature: qr_signature + "zz" });
    expect(junk.status).toBe(401);
    expect(junk.body.error.code).toBe("ERR_SIGNATURE_INVALID");
  });

  it("returns 404 for a card that does not exist in scope", async () => {
    const admin = await loginAs("super_admin");
    const missing = "11111111-1111-1111-1111-111111111111";
    const res = await request(app).get(`/v1/id-cards/${missing}`).set(auth(admin.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ERR_NOT_FOUND");
  });
});
