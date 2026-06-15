import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import app from "../src/app";
import { pool, db, users, otp_codes, device_sessions } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashSecret } from "../src/lib/tokens";
import { SEED_PHONES, loginAs, auth } from "./helpers";

/**
 * Auth / OTP integration tests. These drive the unauthenticated login surface
 * (/api/auth/*) against the live seeded Postgres via supertest.
 *
 * Notes that shape these tests:
 *  - In NODE_ENV=test the in-memory/Redis rate limiter is a no-op, so the
 *    per-IP / per-phone verify caps never fire here. The PER-OTP-ROW
 *    attempts_count cap (MAX_OTP_ATTEMPTS = 5) is NOT bypassed — it is enforced
 *    by the route logic, so the lockout test below is meaningful.
 *  - Seeded phones all accept OTP 123456 (the dev default surfaced as dev_code
 *    in the send response). We only rely on dev_code for the happy paths and
 *    use a deliberately-wrong code for the lockout test.
 *
 * Self-created fixtures (temp users + hand-inserted otp rows) are cleaned up in
 * afterAll so reruns stay green.
 */

const MAX_OTP_ATTEMPTS = 5;
const createdUserIds: string[] = [];
const createdOtpTokens: string[] = [];

/** Insert a synthetic users row with a unique phone; tracked for cleanup. */
async function makeUser(over: Partial<typeof users.$inferInsert> = {}): Promise<typeof users.$inferSelect> {
  const phone = `+9197${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
  const [u] = await db
    .insert(users)
    .values({
      phone,
      role: "parent",
      full_name: "Auth Test User",
      is_active: true,
      ...over,
    })
    .returning();
  createdUserIds.push(u.id);
  return u;
}

/** Hand-insert an otp_codes row (bypassing /login send) so we can control its
 * expiry / target phone directly; tracked for cleanup. */
async function makeOtp(phone: string, code: string, over: Partial<typeof otp_codes.$inferInsert> = {}): Promise<string> {
  const otpToken = `test-otp-${randomUUID()}`;
  await db.insert(otp_codes).values({
    phone,
    otp_token: otpToken,
    code_hash: hashSecret(code),
    expires_at: new Date(Date.now() + 5 * 60 * 1000),
    ...over,
  });
  createdOtpTokens.push(otpToken);
  return otpToken;
}

/** Drive only the OTP-send phase for a phone, returning the fresh otp_token. */
async function sendOtp(phone: string): Promise<string> {
  const res = await request(app).post("/api/auth/login").send({ phase: "send", phone });
  expect(res.status).toBe(200);
  return res.body.data.otp_token as string;
}

afterAll(async () => {
  if (createdOtpTokens.length) {
    for (const t of createdOtpTokens) {
      await db.delete(otp_codes).where(eq(otp_codes.otp_token, t)).catch(() => undefined);
    }
  }
  for (const id of createdUserIds) {
    await db.delete(device_sessions).where(eq(device_sessions.user_id, id)).catch(() => undefined);
    await db.delete(users).where(eq(users.id, id)).catch(() => undefined);
  }
  await pool.end();
});

describe("auth / OTP login", () => {
  it("happy path: send then verify mints tokens + a session user", async () => {
    const phone = SEED_PHONES.parent;
    const send = await request(app).post("/api/auth/login").send({ phase: "send", phone });
    expect(send.status).toBe(200);
    expect(typeof send.body.data.otp_token).toBe("string");
    const code = send.body.data.dev_code ?? "123456";

    const verify = await request(app)
      .post("/api/auth/login")
      .send({ phase: "verify", otp_token: send.body.data.otp_token, code, device_id: "test-happy" });
    expect(verify.status).toBe(200);
    expect(verify.body.data.user.phone).toBe(phone);
    expect(verify.body.data.user.role).toBe("parent");
    expect(typeof verify.body.data.tokens.access_token).toBe("string");
    expect(typeof verify.body.data.tokens.refresh_token).toBe("string");

    // The minted access token works against an authed endpoint.
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${verify.body.data.tokens.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.phone).toBe(phone);
  });

  it("wrong OTP increments attempts; the 6th attempt is locked (MAX_OTP_ATTEMPTS)", async () => {
    const phone = SEED_PHONES.student;
    const otpToken = await sendOtp(phone);
    const wrong = "000001"; // never equals the seeded 123456

    // Attempts 1..MAX_OTP_ATTEMPTS each return ERR_OTP_INVALID and bump the
    // per-row attempts_count. The check `attempts_count >= MAX` runs BEFORE the
    // hash compare, so once the counter reaches the cap the next attempt locks.
    for (let i = 0; i < MAX_OTP_ATTEMPTS; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ phase: "verify", otp_token: otpToken, code: wrong, device_id: "test-lock" });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("ERR_OTP_INVALID");
    }

    // 6th attempt: attempts_count is now MAX, so the row is locked.
    const locked = await request(app)
      .post("/api/auth/login")
      .send({ phase: "verify", otp_token: otpToken, code: wrong, device_id: "test-lock" });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe("ERR_OTP_LOCKED");

    // And once locked, even the CORRECT code is rejected (lockout, not a bypass).
    const correctButLocked = await request(app)
      .post("/api/auth/login")
      .send({ phase: "verify", otp_token: otpToken, code: "123456", device_id: "test-lock" });
    expect(correctButLocked.status).toBe(429);
    expect(correctButLocked.body.error.code).toBe("ERR_OTP_LOCKED");
  });

  it("rejects a consumed otp_token (single use)", async () => {
    const phone = SEED_PHONES.shikshak;
    const send = await request(app).post("/api/auth/login").send({ phase: "send", phone });
    expect(send.status).toBe(200);
    const otpToken = send.body.data.otp_token as string;
    const code = send.body.data.dev_code ?? "123456";

    // First verify consumes the token.
    const first = await request(app)
      .post("/api/auth/login")
      .send({ phase: "verify", otp_token: otpToken, code, device_id: "test-consume" });
    expect(first.status).toBe(200);

    // Replaying the same (now consumed) token is rejected as invalid/expired.
    const replay = await request(app)
      .post("/api/auth/login")
      .send({ phase: "verify", otp_token: otpToken, code, device_id: "test-consume" });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("ERR_OTP_INVALID");
  });

  it("rejects an expired otp_token", async () => {
    const phone = SEED_PHONES.sanchalak;
    const otpToken = await makeOtp(phone, "123456", {
      expires_at: new Date(Date.now() - 60 * 1000), // already expired
    });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ phase: "verify", otp_token: otpToken, code: "123456", device_id: "test-expired" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("ERR_OTP_INVALID");
  });

  it("rejects verify for an inactive user (correct code, but no active account)", async () => {
    const u = await makeUser({ is_active: false });
    const otpToken = await makeOtp(u.phone, "654321");
    const res = await request(app)
      .post("/api/auth/login")
      .send({ phase: "verify", otp_token: otpToken, code: "654321", device_id: "test-inactive" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ERR_NO_ACCOUNT");
  });

  it("rejects verify for a soft-deleted user (correct code, but account is deleted)", async () => {
    const u = await makeUser({ is_active: true, deleted_at: new Date() });
    const otpToken = await makeOtp(u.phone, "111222");
    const res = await request(app)
      .post("/api/auth/login")
      .send({ phase: "verify", otp_token: otpToken, code: "111222", device_id: "test-deleted" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ERR_NO_ACCOUNT");
  });

  it("refresh rotates the token and rejects reuse of the OLD refresh token", async () => {
    // Fresh login to get a refresh token we fully control.
    const phone = SEED_PHONES.parent;
    const send = await request(app).post("/api/auth/login").send({ phase: "send", phone });
    const code = send.body.data.dev_code ?? "123456";
    const verify = await request(app)
      .post("/api/auth/login")
      .send({ phase: "verify", otp_token: send.body.data.otp_token, code, device_id: "test-rotate" });
    expect(verify.status).toBe(200);
    const oldRefresh = verify.body.data.tokens.refresh_token as string;

    // Refresh rotates: a new refresh token is issued and the old hash is replaced.
    const refreshed = await request(app).post("/api/auth/refresh").send({ refresh_token: oldRefresh });
    expect(refreshed.status).toBe(200);
    const newRefresh = refreshed.body.data.tokens.refresh_token as string;
    expect(typeof newRefresh).toBe("string");
    expect(newRefresh).not.toBe(oldRefresh);

    // Reusing the OLD (rotated-away) refresh token must fail.
    const reuse = await request(app).post("/api/auth/refresh").send({ refresh_token: oldRefresh });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe("ERR_REFRESH_INVALID");

    // The NEW token still works (sanity: rotation didn't break the live session).
    const stillGood = await request(app).post("/api/auth/refresh").send({ refresh_token: newRefresh });
    expect(stillGood.status).toBe(200);
  });

  it("logout revokes the device session so a subsequent refresh 401s", async () => {
    const phone = SEED_PHONES.shikshak;
    const send = await request(app).post("/api/auth/login").send({ phase: "send", phone });
    const code = send.body.data.dev_code ?? "123456";
    const verify = await request(app)
      .post("/api/auth/login")
      .send({ phase: "verify", otp_token: send.body.data.otp_token, code, device_id: "test-logout" });
    expect(verify.status).toBe(200);
    const refresh = verify.body.data.tokens.refresh_token as string;

    // Logout revokes the session bound to this refresh token (mobile-style body).
    const logout = await request(app).post("/api/auth/logout").send({ refresh_token: refresh });
    expect(logout.status).toBe(204);

    // The revoked session can no longer refresh.
    const afterLogout = await request(app).post("/api/auth/refresh").send({ refresh_token: refresh });
    expect(afterLogout.status).toBe(401);
    expect(afterLogout.body.error.code).toBe("ERR_REFRESH_INVALID");
  });

  it("requires a refresh token to refresh at all", async () => {
    const res = await request(app).post("/api/auth/refresh").send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("ERR_NO_REFRESH");
  });
});

/** Pull a named cookie's raw value out of a supertest Set-Cookie header array. */
function cookieValue(res: request.Response, name: string): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  if (!raw) return undefined;
  const line = raw.find((c) => c.startsWith(`${name}=`));
  if (!line) return undefined;
  const v = line.slice(name.length + 1).split(";")[0];
  return decodeURIComponent(v);
}

describe("admin impersonation", () => {
  it("super_admin starts impersonation: subject session minted + banner cookies set", async () => {
    const admin = await loginAs("super_admin");
    // Resolve a non-super_admin target (the seeded parent).
    const [parent] = await db.select().from(users).where(eq(users.phone, SEED_PHONES.parent)).limit(1);
    expect(parent).toBeTruthy();

    const res = await request(app)
      .post(`/v1/admin/impersonate/${parent.id}`)
      .set(auth(admin.token));
    expect(res.status).toBe(200);
    // Response carries a real subject session.
    expect(res.body.data.user.id).toBe(parent.id);
    expect(res.body.data.user.role).toBe("parent");
    expect(typeof res.body.data.tokens.access_token).toBe("string");

    // Auth cookies now point at the SUBJECT and the banner flag is set so the
    // web AdminLayout renders the ImpersonationBanner (jp_imp_active === 'true').
    expect(cookieValue(res, "jp_imp_active")).toBe("true");
    expect(cookieValue(res, "jp_imp_origin_name")).toBe("Super Admin");
    const userCookie = cookieValue(res, "jp_user");
    expect(userCookie).toBeTruthy();
    expect(JSON.parse(userCookie!).id).toBe(parent.id);

    // The minted subject access token authorises exactly as the parent.
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${res.body.data.tokens.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.id).toBe(parent.id);
  });

  it("forbids non-super_admin from starting impersonation", async () => {
    const cityAdmin = await loginAs("city_admin");
    const [parent] = await db.select().from(users).where(eq(users.phone, SEED_PHONES.parent)).limit(1);
    const res = await request(app)
      .post(`/v1/admin/impersonate/${parent.id}`)
      .set(auth(cityAdmin.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ERR_FORBIDDEN");
  });

  it("requires auth to start impersonation", async () => {
    const [parent] = await db.select().from(users).where(eq(users.phone, SEED_PHONES.parent)).limit(1);
    const res = await request(app).post(`/v1/admin/impersonate/${parent.id}`);
    expect(res.status).toBe(401);
  });

  it("cannot impersonate another super_admin", async () => {
    const admin = await loginAs("super_admin");
    const other = await makeUser({ role: "super_admin", full_name: "Other Super" });
    const res = await request(app)
      .post(`/v1/admin/impersonate/${other.id}`)
      .set(auth(admin.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ERR_FORBIDDEN");
  });

  it("cannot impersonate yourself", async () => {
    const admin = await loginAs("super_admin");
    const res = await request(app)
      .post(`/v1/admin/impersonate/${admin.user.id}`)
      .set(auth(admin.token));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });

  it("404s for an unknown / inactive impersonation target", async () => {
    const admin = await loginAs("super_admin");
    const inactive = await makeUser({ is_active: false });
    const missing = await request(app)
      .post(`/v1/admin/impersonate/${randomUUID()}`)
      .set(auth(admin.token));
    expect(missing.status).toBe(404);
    const inactiveRes = await request(app)
      .post(`/v1/admin/impersonate/${inactive.id}`)
      .set(auth(admin.token));
    expect(inactiveRes.status).toBe(404);
  });

  it("stop clears the impersonation cookies (authenticated via jp_imp_active)", async () => {
    // Stop authenticates off the jp_imp_active cookie (the live session during
    // impersonation is the SUBJECT, who may have no admin-panel access).
    const res = await request(app)
      .post("/v1/admin/impersonate/stop")
      .set("Cookie", ["jp_imp_active=true"])
      .set("X-Requested-With", "XMLHttpRequest");
    expect(res.status).toBe(200);
    expect(res.body.data.stopped).toBe(true);
    // Clearing emits expiring Set-Cookie entries for the impersonation flags.
    const cleared = (res.headers["set-cookie"] as unknown as string[]).join("\n");
    expect(cleared).toContain("jp_imp_active=");
    expect(cleared).toContain("jp_user=");
  });

  it("stop without an active impersonation cookie is rejected", async () => {
    const res = await request(app)
      .post("/v1/admin/impersonate/stop")
      .set("X-Requested-With", "XMLHttpRequest");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ERR_NO_IMPERSONATION");
  });
});
