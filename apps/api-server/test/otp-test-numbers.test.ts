import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool, db, otp_codes } from "@workspace/db";
import { eq } from "drizzle-orm";
import { _resetTestOtpNumbers } from "../src/lib/otp-test-numbers";
import { SEED_PHONES } from "./helpers";

/**
 * Store-review test numbers (the Firebase "phone numbers for testing" pattern).
 *
 * These assert the properties that make the mechanism safe to run in production:
 * a nominated number takes the fixed code without any SMS, the fixed code is
 * never echoed back over the wire, and no other number is affected.
 */

const TEST_PHONE = SEED_PHONES.student; // low-privilege demo account
const TEST_CODE = "246813";
const createdTokens: string[] = [];

async function send(phone: string) {
  const res = await request(app).post("/api/auth/login").send({ phase: "send", phone });
  if (res.body?.data?.otp_token) createdTokens.push(res.body.data.otp_token);
  return res;
}

beforeAll(() => {
  process.env.OTP_TEST_NUMBERS = `${TEST_PHONE}:${TEST_CODE}`;
  _resetTestOtpNumbers();
});

afterAll(async () => {
  delete process.env.OTP_TEST_NUMBERS;
  _resetTestOtpNumbers();
  for (const token of createdTokens) {
    await db.delete(otp_codes).where(eq(otp_codes.otp_token, token));
  }
  await pool.end();
});

describe("otp test numbers", () => {
  it("a nominated number signs in with the fixed code", async () => {
    const sent = await send(TEST_PHONE);
    expect(sent.status).toBe(200);

    const verified = await request(app).post("/api/auth/login").send({
      phase: "verify",
      otp_token: sent.body.data.otp_token,
      code: TEST_CODE,
      device_id: "otp-test-numbers",
    });
    expect(verified.status).toBe(200);
    expect(verified.body.data.user.phone).toBe(TEST_PHONE);
    expect(verified.body.data.tokens.access_token).toBeTruthy();
  });

  it("never echoes the fixed code in the send response", async () => {
    // The reviewer has the code out of band; returning it would turn the
    // allow-list into a public oracle for the nominated account.
    const sent = await send(TEST_PHONE);
    expect(sent.body.data.dev_code).toBeUndefined();
  });

  it("stores a locally-verifiable challenge, never a provider session", async () => {
    const sent = await send(TEST_PHONE);
    const [row] = await db
      .select()
      .from(otp_codes)
      .where(eq(otp_codes.otp_token, sent.body.data.otp_token))
      .limit(1);
    expect(row.session_id).toBeNull();
    expect(row.code_hash).not.toBeNull();
  });

  it("rejects a wrong code on a nominated number", async () => {
    const sent = await send(TEST_PHONE);
    const verified = await request(app).post("/api/auth/login").send({
      phase: "verify",
      otp_token: sent.body.data.otp_token,
      code: "000000",
      device_id: "otp-test-numbers",
    });
    expect(verified.status).toBe(401);
  });

  it("leaves every other number on the normal path", async () => {
    // A number that is not nominated must not accept the fixed code.
    const sent = await send(SEED_PHONES.parent);
    const verified = await request(app).post("/api/auth/login").send({
      phase: "verify",
      otp_token: sent.body.data.otp_token,
      code: TEST_CODE,
      device_id: "otp-test-numbers",
    });
    expect(verified.status).toBe(401);
  });

  it("ignores malformed allow-list entries", async () => {
    process.env.OTP_TEST_NUMBERS = "not-a-phone:123456,+919800000007,+919800000007:abc";
    _resetTestOtpNumbers();
    const sent = await send(TEST_PHONE);
    const verified = await request(app).post("/api/auth/login").send({
      phase: "verify",
      otp_token: sent.body.data.otp_token,
      code: TEST_CODE,
      device_id: "otp-test-numbers",
    });
    expect(verified.status).toBe(401);

    process.env.OTP_TEST_NUMBERS = `${TEST_PHONE}:${TEST_CODE}`;
    _resetTestOtpNumbers();
  });
});
