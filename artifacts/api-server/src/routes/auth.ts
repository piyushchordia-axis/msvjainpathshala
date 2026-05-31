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

const router: IRouter = Router();

const OTP_TTL_SECONDS = 5 * 60;
const MAX_OTP_ATTEMPTS = 5;
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
    const [otpSetting] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "default_otp_code"))
      .limit(1);
    if (otpSetting?.value) {
      code = otpSetting.value;
    }

    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

    // Always create a token row so timing does not leak whether the phone exists.
    await db.insert(otp_codes).values({
      phone: parsed.phone,
      otp_token: otpToken,
      code_hash: hashSecret(code),
      expires_at: expiresAt,
    });

    const payload: { otp_token: string; expires_in_seconds: number; dev_code?: string } = {
      otp_token: otpToken,
      expires_in_seconds: OTP_TTL_SECONDS,
    };
    // Surface the code in the response for registered users (no real SMS).
    if (user) payload.dev_code = code;
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
  const refresh = (req.cookies as Record<string, string> | undefined)?.jp_refresh;
  if (refresh) {
    await db
      .update(device_sessions)
      .set({ revoked_at: new Date() })
      .where(eq(device_sessions.refresh_token_hash, hashSecret(refresh)))
      .catch(() => undefined);
  }
  clearAuthCookies(res);
  res.status(204).end();
}

router.post("/logout", handleLogout);
router.delete("/logout", handleLogout);

void TOKEN_TTL;

export default router;
