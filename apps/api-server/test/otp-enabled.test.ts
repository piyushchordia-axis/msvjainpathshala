import { describe, it, expect, afterAll, beforeAll, afterEach } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool, db, otp_codes } from "@workspace/db";
import { eq } from "drizzle-orm";
import { _resetOtpConfig } from "../src/lib/otp-config";
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
  delete process.env.OTP_ENABLED;
  delete process.env.DEFAULT_OTP;
  delete process.env.DEFAULT_OTP_FLAG;
  delete process.env.OTP_FIXED_ENABLED;
  delete process.env.OTP_FIXED_CODE;
  _resetOtpConfig();
});

afterAll(async () => {
  delete process.env.OTP_ENABLED;
  delete process.env.DEFAULT_OTP;
  delete process.env.DEFAULT_OTP_FLAG;
  delete process.env.OTP_FIXED_ENABLED;
  delete process.env.OTP_FIXED_CODE;
  _resetOtpConfig();
  for (const token of createdTokens) {
    await db.delete(otp_codes).where(eq(otp_codes.otp_token, token));
  }
  await pool.end();
});

describe("OTP_ENABLED / DEFAULT_OTP / DEFAULT_OTP_FLAG", () => {
  it("OTP_ENABLED=false accepts DEFAULT_OTP 123456 and stores a local hash", async () => {
    process.env.OTP_ENABLED = "false";
    _resetOtpConfig();

    const sent = await send(PHONE);
    expect(sent.status).toBe(200);
    expect(sent.body.data.dev_code).toBeUndefined();

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
      device_id: "otp-default",
    });
    expect(verified.status).toBe(200);
    expect(verified.body.data.user.phone).toBe(PHONE);
  });

  it("honours a custom DEFAULT_OTP when SMS is off", async () => {
    process.env.OTP_ENABLED = "false";
    process.env.DEFAULT_OTP = "654321";
    _resetOtpConfig();

    const sent = await send(PHONE);
    expect(sent.status).toBe(200);

    const wrong = await request(app).post("/api/auth/login").send({
      phase: "verify",
      otp_token: sent.body.data.otp_token,
      code: "123456",
      device_id: "otp-custom-wrong",
    });
    expect(wrong.status).toBe(401);

    const sent2 = await send(PHONE);
    const ok = await request(app).post("/api/auth/login").send({
      phase: "verify",
      otp_token: sent2.body.data.otp_token,
      code: "654321",
      device_id: "otp-custom-ok",
    });
    expect(ok.status).toBe(200);
  });

  it("rejects a wrong code while OTP_ENABLED=false", async () => {
    process.env.OTP_ENABLED = "false";
    _resetOtpConfig();

    const sent = await send(PHONE);
    const verified = await request(app).post("/api/auth/login").send({
      phase: "verify",
      otp_token: sent.body.data.otp_token,
      code: "000000",
      device_id: "otp-reject",
    });
    expect(verified.status).toBe(401);
  });

  it("OTP_ENABLED=true + DEFAULT_OTP_FLAG=false does not accept DEFAULT_OTP", async () => {
    process.env.OTP_ENABLED = "true";
    process.env.DEFAULT_OTP_FLAG = "false";
    process.env.DEFAULT_OTP = "654321";
    _resetOtpConfig();

    const sent = await send(PHONE);
    expect(sent.status).toBe(200);
    expect(sent.body.data.dev_code).toBeUndefined();

    const verified = await request(app).post("/api/auth/login").send({
      phase: "verify",
      otp_token: sent.body.data.otp_token,
      code: "654321",
      device_id: "otp-live-random",
    });
    expect(verified.status).toBe(401);
  });

  it("OTP_ENABLED=true + DEFAULT_OTP_FLAG=true sends DEFAULT_OTP (mock SMS)", async () => {
    process.env.OTP_ENABLED = "true";
    process.env.DEFAULT_OTP_FLAG = "true";
    process.env.DEFAULT_OTP = "654321";
    _resetOtpConfig();

    const sent = await send(PHONE);
    expect(sent.status).toBe(200);

    const verified = await request(app).post("/api/auth/login").send({
      phase: "verify",
      otp_token: sent.body.data.otp_token,
      code: "654321",
      device_id: "otp-live-fixed",
    });
    expect(verified.status).toBe(200);
    expect(verified.body.data.user.phone).toBe(PHONE);
  });

  it("deprecated OTP_FIXED_ENABLED=true still maps to fixed OTP", async () => {
    process.env.OTP_FIXED_ENABLED = "true";
    process.env.OTP_FIXED_CODE = "111222";
    _resetOtpConfig();

    const sent = await send(PHONE);
    expect(sent.status).toBe(200);
    const verified = await request(app).post("/api/auth/login").send({
      phase: "verify",
      otp_token: sent.body.data.otp_token,
      code: "111222",
      device_id: "otp-compat",
    });
    expect(verified.status).toBe(200);
  });
});
