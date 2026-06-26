import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, users, otp_codes, device_sessions, settings } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  loginRequestSchema,
  type SessionUser,
} from "@workspace/api-zod";
import { fail } from "../lib/envelope";
import {
  generateOtpCode,
  generateOtpToken,
  generateRefreshToken,
  hashSecret,
  signAccessToken,
  TOKEN_TTL,
  verifyAccessToken,
} from "../lib/tokens";
import { setAuthCookies, clearAuthCookies } from "../lib/cookies";
import { getSmsProvider } from "../lib/sms";
import { logger } from "../lib/logger";
import { rateLimit } from "../lib/ratelimit";
import { auditFromReq } from "../lib/audit";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const OTP_TTL_SECONDS = 5 * 60;
const MAX_OTP_ATTEMPTS = 5;
const RL_WINDOW_SECONDS = 15 * 60;
const isProd = process.env.NODE_ENV === "production";

function toSessionUser(u: typeof users.$inferSelect): SessionUser {
  return {
    id: u.id,
    phone: u.phone,
    role: u.role,
    full_name: u.full_name,
    preferred_language: u.preferred_language,
  };
}

router.post("/login", async (req: Request, res: Response) => {
  let parsed: z.infer<typeof loginRequestSchema>;
  try {
    parsed = loginRequestSchema.parse(req.body);
  } catch (err) {
    const msg = err instanceof z.ZodError ? (err.issues[0]?.message ?? "Invalid body") : "Invalid body";
    fail(res, 422, "ERR_VALIDATION_FAILED", msg);
    return;
  }

  const ip = req.ip ?? "unknown";
  if (parsed.phase === "send") {
    // 5 sends per phone / 15 min, plus a per-IP cap to stop SMS/DB amplification.
    if (
      (await rateLimit(`otp:send:phone:${parsed.phone}`, 5, RL_WINDOW_SECONDS)) ||
      (await rateLimit(`otp:send:ip:${ip}`, 30, RL_WINDOW_SECONDS))
    ) {
      fail(res, 429, "ERR_RATE_LIMITED", "Too many requests. Please try again later.");
      return;
    }
  } else if (await rateLimit(`otp:verify:ip:${ip}`, 30, RL_WINDOW_SECONDS)) {
    // Cap verify attempts per IP so fresh-token issuance can't brute the code.
    fail(res, 429, "ERR_RATE_LIMITED", "Too many attempts. Please try again later.");
    return;
  }

  if (parsed.phase === "send") {
    // Only registered (seeded) phones can receive a code.
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.phone, parsed.phone), isNull(users.deleted_at)))
      .limit(1);

    const otpToken = generateOtpToken();
    let code = generateOtpCode();

    // Check settings table for a default OTP override (e.g. "123456").
    // DEV-ONLY: never honour a fixed/default OTP in production, even if the
    // settings row leaks into a prod DB via a seed.
    if (!isProd) {
      const [otpSetting] = await db
        .select()
        .from(settings)
        .where(eq(settings.key, "default_otp_code"))
        .limit(1);
      if (otpSetting?.value) {
        code = otpSetting.value;
      }
    }

    // Guarded review login: an allow-list of demo phones may use a fixed code
    // even in production, so app-store reviewers / QA can sign in without live
    // SMS. REVIEW_OTP_PHONE is a comma-separated list; ONLY those exact numbers
    // are affected — every other phone keeps the normal random-code + SMS flow.
    // Unset both env vars to disable.
    const reviewPhones = (process.env["REVIEW_OTP_PHONE"] ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const reviewCode = process.env["REVIEW_OTP_CODE"];
    if (reviewCode && reviewPhones.includes(parsed.phone)) {
      code = reviewCode;
    }

    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

    // Always create a token row so timing does not leak whether the phone exists.
    await db.insert(otp_codes).values({
      phone: parsed.phone,
      otp_token: otpToken,
      code_hash: hashSecret(code),
      expires_at: expiresAt,
    });

    // Deliver the code via SMS for registered phones only (mirrors dev_code
    // gating). Best-effort: a delivery failure must not leak the code or fail
    // the request, and must not reveal whether the phone is registered via
    // timing/error differences. In dev/test the mock resolves without network,
    // so existing tests and the dev_code path are unaffected.
    if (user) {
      try {
        await getSmsProvider().sendOtp(parsed.phone, code);
      } catch (err) {
        logger.error({ err, phone: parsed.phone }, "OTP SMS delivery failed");
      }
    }

    const payload: { otp_token: string; expires_in_seconds: number; dev_code?: string } = {
      otp_token: otpToken,
      expires_in_seconds: OTP_TTL_SECONDS,
    };
    // Surface the code in the response for registered users (no real SMS).
    // DEV-ONLY: returning the OTP in the response is an account-takeover
    // backdoor in production — gate it behind a non-prod environment.
    if (user && !isProd) payload.dev_code = code;
    res.status(200).json({ data: payload });
    return;
  }

  // phase === "verify"
  const [otp] = await db
    .select()
    .from(otp_codes)
    .where(eq(otp_codes.otp_token, parsed.otp_token))
    .limit(1);

  if (!otp || otp.consumed_at || otp.expires_at.getTime() < Date.now()) {
    fail(res, 401, "ERR_OTP_INVALID", "This code has expired. Please request a new one.");
    return;
  }
  // Per-PHONE verify cap (in addition to the per-IP cap above): a rotating-IP
  // attacker can sidestep the IP cap, so also bound verify attempts against the
  // targeted account to close the code-grinding gap. Resolved from the otp row.
  if (await rateLimit(`otp:verify:phone:${otp.phone}`, 30, RL_WINDOW_SECONDS)) {
    fail(res, 429, "ERR_RATE_LIMITED", "Too many attempts. Please try again later.");
    return;
  }
  if (otp.attempts_count >= MAX_OTP_ATTEMPTS) {
    fail(res, 429, "ERR_OTP_LOCKED", "Too many attempts. Please request a new code.");
    return;
  }

  if (otp.code_hash !== hashSecret(parsed.code)) {
    await db
      .update(otp_codes)
      .set({ attempts_count: otp.attempts_count + 1 })
      .where(eq(otp_codes.id, otp.id));
    fail(res, 401, "ERR_OTP_INVALID", "Incorrect code. Please try again.");
    return;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.phone, otp.phone), isNull(users.deleted_at)))
    .limit(1);

  if (!user || !user.is_active) {
    fail(res, 403, "ERR_NO_ACCOUNT", "No active account is registered for this number.");
    return;
  }

  await db.update(otp_codes).set({ consumed_at: new Date() }).where(eq(otp_codes.id, otp.id));

  const access = signAccessToken(user.id);
  const refresh = generateRefreshToken();

  await db.insert(device_sessions).values({
    user_id: user.id,
    device_id: parsed.device_id,
    platform: "web",
    refresh_token_hash: refresh.hash,
    expires_at: refresh.expiresAt,
    last_used_at: new Date(),
  });
  await db.update(users).set({ last_login_at: new Date() }).where(eq(users.id, user.id));

  const sessionUser = toSessionUser(user);
  setAuthCookies(res, sessionUser, access.token, access.expiresAt, refresh.token, refresh.expiresAt);

  // Record the successful login. auditFromReq pulls actor/role/ip off the
  // request; this is an unauthenticated endpoint so seed authUser with the
  // just-resolved user. Best-effort — auditFromReq never throws.
  req.authUser = user;
  await auditFromReq(req, {
    action: "login",
    entityKind: "auth_session",
    entityId: user.id,
    summary: "User signed in via OTP",
    metadata: { device_id: parsed.device_id },
  });

  res.status(200).json({
    data: {
      user: sessionUser,
      tokens: {
        access_token: access.token,
        refresh_token: refresh.token,
        access_expires_at: access.expiresAt.toISOString(),
        refresh_expires_at: refresh.expiresAt.toISOString(),
      },
    },
  });
});

router.post("/refresh", async (req: Request, res: Response) => {
  const incoming = (req.cookies as Record<string, string> | undefined)?.jp_refresh
    ?? (typeof req.body?.refresh_token === "string" ? req.body.refresh_token : undefined);
  if (!incoming) {
    fail(res, 401, "ERR_NO_REFRESH", "No refresh token provided.");
    return;
  }
  const [session] = await db
    .select()
    .from(device_sessions)
    .where(eq(device_sessions.refresh_token_hash, hashSecret(incoming)))
    .limit(1);
  if (!session || session.revoked_at || session.expires_at.getTime() < Date.now()) {
    fail(res, 401, "ERR_REFRESH_INVALID", "Session expired. Please sign in again.");
    return;
  }
  const [user] = await db.select().from(users).where(eq(users.id, session.user_id)).limit(1);
  if (!user || !user.is_active) {
    fail(res, 401, "ERR_USER_INACTIVE", "Account is not active.");
    return;
  }

  const access = signAccessToken(user.id);
  const refresh = generateRefreshToken();
  await db
    .update(device_sessions)
    .set({ refresh_token_hash: refresh.hash, expires_at: refresh.expiresAt, last_used_at: new Date() })
    .where(eq(device_sessions.id, session.id));

  const sessionUser = toSessionUser(user);
  setAuthCookies(res, sessionUser, access.token, access.expiresAt, refresh.token, refresh.expiresAt);
  res.status(200).json({
    data: {
      user: sessionUser,
      tokens: {
        access_token: access.token,
        refresh_token: refresh.token,
        access_expires_at: access.expiresAt.toISOString(),
        refresh_expires_at: refresh.expiresAt.toISOString(),
      },
    },
  });
});

router.get("/me", async (req: Request, res: Response) => {
  const cookie = (req.cookies as Record<string, string> | undefined)?.jp_access;
  const header = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = header ?? cookie;
  if (!token) {
    fail(res, 401, "ERR_UNAUTHENTICATED", "Not signed in.");
    return;
  }
  const verified = verifyAccessToken(token);
  if (!verified) {
    fail(res, 401, "ERR_TOKEN_INVALID", "Session expired.");
    return;
  }
  const [user] = await db.select().from(users).where(eq(users.id, verified.uid)).limit(1);
  if (!user || !user.is_active) {
    fail(res, 401, "ERR_USER_INACTIVE", "Account is not active.");
    return;
  }
  res.status(200).json({ data: { user: toSessionUser(user) } });
});

async function handleLogout(req: Request, res: Response): Promise<void> {
  // Web sends the refresh token via HttpOnly cookie; mobile (no cookie) sends it
  // in the body so the session is revoked server-side on logout.
  const refresh = (req.cookies as Record<string, string> | undefined)?.jp_refresh
    ?? (typeof req.body?.refresh_token === "string" ? req.body.refresh_token : undefined);
  if (refresh) {
    // Resolve the session's owner before revoking so the audit entry records
    // who logged out (auditFromReq reads actor/role from req.authUser).
    const [session] = await db
      .select({ id: device_sessions.id, user_id: device_sessions.user_id })
      .from(device_sessions)
      .where(eq(device_sessions.refresh_token_hash, hashSecret(refresh)))
      .limit(1)
      .catch(() => [] as { id: string; user_id: string }[]);

    await db
      .update(device_sessions)
      .set({ revoked_at: new Date() })
      .where(eq(device_sessions.refresh_token_hash, hashSecret(refresh)))
      .catch(() => undefined);

    if (session) {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, session.user_id))
        .limit(1)
        .catch(() => [] as (typeof users.$inferSelect)[]);
      if (user) req.authUser = user;
      await auditFromReq(req, {
        action: "logout",
        entityKind: "auth_session",
        entityId: session.id,
        summary: "User signed out",
      });
    }
  }
  clearAuthCookies(res);
  res.status(204).end();
}

router.post("/logout", handleLogout);
router.delete("/logout", handleLogout);

// Self-service account deletion (required by App Store guideline 5.1.1(v) and
// Google Play for apps with account creation). The signed-in user initiates
// deletion from inside the app: we immediately soft-delete the account (which
// the auth middleware treats as gone) and revoke every device session, so
// access ends at once. Residual records are purged/anonymised within 30 days
// per the public /delete-account policy, subject to legal retention.
async function handleDeleteAccount(req: Request, res: Response): Promise<void> {
  const uid = req.authUser!.id;

  const [deleted] = await db
    .update(users)
    .set({ deleted_at: new Date(), is_active: false, updated_at: new Date() })
    .where(and(eq(users.id, uid), isNull(users.deleted_at)))
    .returning({ id: users.id });

  // Already deleted (idempotent) — still revoke sessions + clear cookies below.
  await db
    .update(device_sessions)
    .set({ revoked_at: new Date() })
    .where(and(eq(device_sessions.user_id, uid), isNull(device_sessions.revoked_at)))
    .catch(() => undefined);

  await auditFromReq(req, {
    action: "delete",
    entityKind: "user_account",
    entityId: uid,
    summary: "User deleted their own account",
  });
  void deleted;

  clearAuthCookies(res);
  res.status(204).end();
}

router.post("/delete-account", requireAuth, handleDeleteAccount);
router.delete("/delete-account", requireAuth, handleDeleteAccount);

void TOKEN_TTL;

export default router;
