import { describe, it, expect, afterAll, beforeAll, afterEach } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool, db, otp_codes } from "@workspace/db";
import { eq } from "drizzle-orm";
import { _resetFixedOtp } from "../src/lib/otp-fixed";
import { _resetTestOtpNumbers } from "../src/lib/otp-test-numbers";
import { SEED_PHONES } from "./helpers";

const PHONE = SEED_PHONES.parent;
const createdTokens: string[] = [];

async function send(phone: string) {
  const res = await request(app).post("/api/auth/login").send({ phase: "send", phone });
  if (res.body?.data?.otp_token) createdTokens.push(res.body.data.otp_token);
  return res;
}

beforeAll(() => {
  delete process.env.OTP_TEST_NUMBERS;
  _resetTestOtpNumbers();
});

afterEach(() => {
  delete process.env.OTP_FIXED_ENABLED;
  delete process.env.OTP_FIXED_CODE;
  _resetFixedOtp();
});

afterAll(async () => {
  delete process.env.OTP_FIXED_ENABLED;
  delete process.env.OTP_FIXED_CODE;
  _resetFixedOtp();
  for (const token of createdTokens) {
    await db.delete(otp_codes).where(eq(otp_codes.otp_token, token));
  }
  await pool.end();
});

describe("OTP_FIXED_ENABLED", () => {
  it("accepts the default fixed code 123456 and skips SMS session", async () => {
    process.env.OTP_FIXED_ENABLED = "true";
    _resetFixedOtp();

    const sent = await send(PHONE);
    expect(sent.status).toBe(200);

    const [row] = await db
      .select()
      .from(otp_codes)
      .where(eq(otp_codes.otp_token, sent.body.data.otp_token))
      .limit(1);
    expect(row.session_id).toBeNull();
    expect(row.code_hash).not.toBeNull();

    const verified = await request(app).post("/api/auth/login").send({
      phase: "verify",
      otp_token: sent.body.data.otp_token,
      code: "123456",
      device_id: "otp-fixed-default",
    });
    expect(verified.status).toBe(200);
    expect(verified.body.data.user.phone).toBe(PHONE);
  });

  it("honours OTP_FIXED_CODE when set", async () => {
    process.env.OTP_FIXED_ENABLED = "1";
    process.env.OTP_FIXED_CODE = "654321";
    _resetFixedOtp();

    const sent = await send(PHONE);
    expect(sent.status).toBe(200);

    const wrong = await request(app).post("/api/auth/login").send({
      phase: "verify",
      otp_token: sent.body.data.otp_token,
      code: "123456",
      device_id: "otp-fixed-custom-wrong",
    });
    expect(wrong.status).toBe(401);

    const sent2 = await send(PHONE);
    const ok = await request(app).post("/api/auth/login").send({
      phase: "verify",
      otp_token: sent2.body.data.otp_token,
      code: "654321",
      device_id: "otp-fixed-custom-ok",
    });
    expect(ok.status).toBe(200);
  });

  it("rejects a wrong code while the flag is on", async () => {
    process.env.OTP_FIXED_ENABLED = "yes";
    _resetFixedOtp();

    const sent = await send(PHONE);
    const verified = await request(app).post("/api/auth/login").send({
      phase: "verify",
      otp_token: sent.body.data.otp_token,
      code: "000000",
      device_id: "otp-fixed-reject",
    });
    expect(verified.status).toBe(401);
  });

  it("when disabled, does not accept an arbitrary fixed code from OTP_FIXED_CODE alone", async () => {
    // Flag off — OTP_FIXED_CODE must not apply. Non-prod still uses
    // settings.default_otp_code (123456); a different fixed code must fail.
    process.env.OTP_FIXED_ENABLED = "false";
    process.env.OTP_FIXED_CODE = "654321";
    _resetFixedOtp();

    const sent = await send(PHONE);
    const verified = await request(app).post("/api/auth/login").send({
      phase: "verify",
      otp_token: sent.body.data.otp_token,
      code: "654321",
      device_id: "otp-fixed-off",
    });
    expect(verified.status).toBe(401);
  });
});
