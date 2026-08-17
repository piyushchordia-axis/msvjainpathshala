import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, users, otp_codes, device_sessions } from "@workspace/db";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import {
  loginRequestSchema,
} from "@workspace/api-zod";
import { fail } from "../lib/envelope";
import {
  generateOtpCode,
  generateOtpToken,
  generateRefreshToken,
  hashOtpCode,
  hashSecret,
  signAccessToken,
  TOKEN_TTL,
  verifyAccessToken,
  verifyOtpCode,
} from "../lib/tokens";
import { setAuthCookies, clearAuthCookies } from "../lib/cookies";
import { getSmsProvider } from "../lib/sms";
import { testOtpCodeFor } from "../lib/otp-test-numbers";
import { defaultOtpCode, isDefaultOtpFlag, isOtpEnabled } from "../lib/otp-config";
import { logger } from "../lib/logger";
import { rateLimit } from "../lib/ratelimit";
import { auditFromReq } from "../lib/audit";
import { requireAuth } from "../middlewares/auth";
import { toSessionUser } from "../lib/session-user";

const router: IRouter = Router();

const OTP_TTL_SECONDS = 5 * 60;
const MAX_OTP_ATTEMPTS = 5;
const RL_WINDOW_SECONDS = 15 * 60;
/** CLAUDE.md auth rules — max 5 device sessions per user; a 6th revokes the oldest. */
const MAX_DEVICE_SESSIONS = 5;

/**
 * Enforce the device cap for `userId` before a new session is inserted.
 *
 * Two things happen here, and the first matters more:
 *
 * 1. Any live session for the SAME device_id is revoked. Login inserted
 *    unconditionally, so signing in six times on one handset created six rows —
 *    the cap would then have evicted five genuine OTHER devices to make room for
 *    duplicates of the one already in your hand.
 * 2. If 5 or more sessions remain, the oldest are revoked until 4 are left, so
 *    the caller's insert lands on exactly 5.
 *
 * Ordered by last_used_at (a session never refreshed sorts first via its null),
 * falling back to created_at.
 */
async function enforceDeviceSessionCap(
  // Structural, matching the SettingsReader pattern in lib/platform-settings.ts —
  // a drizzle transaction is not assignable to `typeof db` ($client is missing).
  tx: Pick<typeof db, "select" | "update">,
  userId: string,
  deviceId: string,
): Promise<void> {
  const now = new Date();
  await tx
    .update(device_sessions)
    .set({ revoked_at: now })
    .where(
      and(
        eq(device_sessions.user_id, userId),
        eq(device_sessions.device_id, deviceId),
        isNull(device_sessions.revoked_at),
      ),
    );

  const live = await tx
    .select({
      id: device_sessions.id,
      last_used_at: device_sessions.last_used_at,
      created_at: device_sessions.created_at,
    })
    .from(device_sessions)
    .where(
      and(
        eq(device_sessions.user_id, userId),
        isNull(device_sessions.revoked_at),
        gt(device_sessions.expires_at, now),
      ),
    );

  const surplus = live.length - (MAX_DEVICE_SESSIONS - 1);
  if (surplus <= 0) return;

  const oldestFirst = [...live].sort((a, b) => {
    const at = a.last_used_at?.getTime() ?? a.created_at?.getTime() ?? 0;
    const bt = b.last_used_at?.getTime() ?? b.created_at?.getTime() ?? 0;
    return at - bt;
  });
  const evict = oldestFirst.slice(0, surplus).map((s) => s.id);
  await tx
    .update(device_sessions)
    .set({ revoked_at: now })
    .where(inArray(device_sessions.id, evict));
}

// Mask a phone number for logs: keep only the last 4 digits (e.g. "****1234")
// so operational logs never carry a full PII phone number.
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length <= 4 ? "****" : `****${digits.slice(-4)}`;
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

    // Store-review test number: an operator-nominated phone that accepts a fixed
    // code and never reaches the SMS provider (see lib/otp-test-numbers.ts).
    // Checked before everything else so it is honoured in production too — that
    // is the point of it — and gated on an explicit allow-list rather than on
    // NODE_ENV. Every other control (rate limits, attempt cap, TTL, single use)
    // still applies.
    const testCode = testOtpCodeFor(parsed.phone);
    if (testCode) code = testCode;

    // OTP_ENABLED=false → DEFAULT_OTP, skip SMS.
    // OTP_ENABLED=true + DEFAULT_OTP_FLAG=true → DEFAULT_OTP over SMS.
    // OTP_ENABLED=true + DEFAULT_OTP_FLAG=false → random code over SMS.
    // Per-phone OTP_TEST_NUMBERS still wins when present.
    const liveSms = !testCode && isOtpEnabled();
    if (!testCode && (!liveSms || isDefaultOtpFlag())) {
      code = defaultOtpCode();
    }

    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

    // Always hash + store locally. Providers only deliver our code — never
    // AUTOGEN session ids. Always insert a row so timing does not leak whether
    // the phone exists. Test numbers and OTP_ENABLED=false skip SMS.
    const deliverBySms = !!user && !testCode && liveSms;
    await db.insert(otp_codes).values({
      phone: parsed.phone,
      otp_token: otpToken,
      code_hash: await hashOtpCode(code),
      session_id: null,
      expires_at: expiresAt,
    });

    // Dispatch SMS off the request path so response timing does not reveal
    // whether the number is registered. Failures are logged (masked phone);
    // the client still gets 200 + otp_token and verifies against our hash.
    if (deliverBySms) {
      const phone = parsed.phone;
      try {
        void getSmsProvider()
          .sendOtp(phone, code)
          .catch((err) => {
            logger.error({ err, phone: maskPhone(phone) }, "OTP SMS delivery failed");
          });
      } catch (err) {
        // getSmsProvider() can throw synchronously (e.g. key without template).
        logger.error({ err, phone: maskPhone(phone) }, "OTP SMS delivery failed");
      }
    }

    const payload: { otp_token: string; expires_in_seconds: number } = {
      otp_token: otpToken,
      expires_in_seconds: OTP_TTL_SECONDS,
    };
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

  // Verification is always local (argon2id). Legacy AUTOGEN rows may still have
  // session_id and a null code_hash — those cannot be verified remotely anymore
  // and are treated as a mismatch (request a new code).
  const matched =
    otp.code_hash !== null && (await verifyOtpCode(otp.code_hash, parsed.code));

  if (!matched) {
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

  await db.transaction(async (tx) => {
    await enforceDeviceSessionCap(tx, user.id, parsed.device_id);
    await tx.insert(device_sessions).values({
      user_id: user.id,
      device_id: parsed.device_id,
      platform: "web",
      refresh_token_hash: refresh.hash,
      expires_at: refresh.expiresAt,
      last_used_at: new Date(),
      // family_id defaults to a fresh uuid — a login starts a new rotation chain.
    });
  });
  await db.update(users).set({ last_login_at: new Date() }).where(eq(users.id, user.id));

  const sessionUser = toSessionUser(user);
  setAuthCookies(res, sessionUser, access.token, access.expiresAt, refresh.token, refresh.expiresAt);

  // Record the successful login. auditFromReq pulls actor/role/ip off the
  // request; this is an unauthenticated endpoint so seed authUser with the
  // just-resolved user. Best-effort — auditFromReq never throws.
  req.authUser = user;
  // Tag the delivery path so a sign-in that used a nominated store-review test
  // number is distinguishable in the audit trail from a real SMS login.
  const viaTestNumber = testOtpCodeFor(otp.phone) !== null;
  await auditFromReq(req, {
    action: "login",
    entityKind: "auth_session",
    entityId: user.id,
    summary: viaTestNumber
      ? "User signed in via OTP (store-review test number)"
      : "User signed in via OTP",
    metadata: { device_id: parsed.device_id, test_number: viaTestNumber },
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

/**
 * A presented token that maps to an ALREADY-REVOKED row is a replay of a token
 * that was consumed by rotation — proof that a second copy of it exists.
 *
 * Guarded on the family still having live sessions, which distinguishes a replay
 * from the benign cases that also leave revoked rows behind: an ordinary logout,
 * and a session evicted by the 5-device cap. Both leave the family with nothing
 * live, so neither raises a false alarm.
 *
 * Only one party can hold the current token, and we cannot tell which caller is
 * the thief — so the whole family goes. The real user re-authenticates by OTP;
 * the attacker's rolling session dies with it.
 */
async function revokeFamilyOnReuse(
  session: typeof device_sessions.$inferSelect,
  req: Request,
): Promise<void> {
  if (!session.revoked_at) return;

  const revoked = await db
    .update(device_sessions)
    .set({ revoked_at: new Date() })
    .where(
      and(
        eq(device_sessions.family_id, session.family_id),
        isNull(device_sessions.revoked_at),
      ),
    )
    .returning({ id: device_sessions.id });

  if (revoked.length === 0) return; // logout / cap eviction — nothing live to protect.

  logger.warn(
    { user_id: session.user_id, family_id: session.family_id, revoked: revoked.length },
    "[auth] refresh token reuse detected; family revoked",
  );
  await auditFromReq(req, {
    action: "logout",
    entityKind: "auth_session",
    entityId: session.user_id,
    summary: "Refresh token reuse detected — all sessions in the family were revoked.",
    metadata: { family_id: session.family_id, revoked_sessions: revoked.length },
  });
}

router.post("/refresh", async (req: Request, res: Response) => {
  const incoming = (req.cookies as Record<string, string> | undefined)?.jp_refresh
    ?? (typeof req.body?.refresh_token === "string" ? req.body.refresh_token : undefined);
  if (!incoming) {
    fail(res, 401, "ERR_NO_REFRESH", "No refresh token provided.");
    return;
  }
  const incomingHash = hashSecret(incoming);
  const [session] = await db
    .select()
    .from(device_sessions)
    .where(eq(device_sessions.refresh_token_hash, incomingHash))
    .limit(1);
  if (!session || session.revoked_at || session.expires_at.getTime() < Date.now()) {
    // A revoked row means this exact token was already consumed by a rotation —
    // i.e. replayed. Previously this path just 401'd and the thief kept
    // refreshing indefinitely on their own rotated copy.
    if (session) await revokeFamilyOnReuse(session, req);
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
  // Rotate by revoking this row and inserting a successor in the same family,
  // rather than overwriting the hash in place. The consumed token stays on
  // record, so a replay is detectable however many times the real user has
  // rotated since. Exactly one row per family stays live, so the 5-device cap
  // (which counts revoked_at IS NULL) is unaffected.
  await db.transaction(async (tx) => {
    await tx
      .update(device_sessions)
      .set({ revoked_at: new Date() })
      .where(eq(device_sessions.id, session.id));
    await tx.insert(device_sessions).values({
      user_id: session.user_id,
      device_id: session.device_id,
      platform: session.platform,
      family_id: session.family_id,
      refresh_token_hash: refresh.hash,
      expires_at: refresh.expiresAt,
      last_used_at: new Date(),
    });
  });

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

  const { invalidateAuthUserCache } = await import("../lib/auth-user-cache");
  await invalidateAuthUserCache(uid);

  const { unpublishTeamMemberForUser } = await import("../lib/team-members-sync");
  await unpublishTeamMemberForUser(uid);

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
