import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";

const SECRET = (() => {
  const fromEnv = process.env.JP_AUTH_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JP_AUTH_SECRET environment variable is required in production but was not provided.",
    );
  }
  return "jp-dev-secret-do-not-use-in-production";
})();

// Short-lived access token (default 1h) — clients silently refresh. Tunable via
// env for different deployments. Refresh token is long-lived (30 days).
const ACCESS_TTL_SECONDS = Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 60 * 60);
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export const TOKEN_TTL = {
  accessSeconds: ACCESS_TTL_SECONDS,
  refreshSeconds: REFRESH_TTL_SECONDS,
};

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

interface AccessPayload {
  uid: string;
  exp: number; // unix seconds
}

export function signAccessToken(uid: string, ttlSeconds = ACCESS_TTL_SECONDS): { token: string; expiresAt: Date } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload: AccessPayload = { uid, exp };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
  return { token: `${body}.${sig}`, expiresAt: new Date(exp * 1000) };
}

export function verifyAccessToken(token: string): { uid: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = createHmac("sha256", SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AccessPayload;
    if (!payload.uid || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { uid: payload.uid };
  } catch {
    return null;
  }
}

export function generateRefreshToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    hash: hashSecret(token),
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
  };
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function generateOtpToken(): string {
  return randomBytes(24).toString("base64url");
}

export function generateOtpCode(): string {
  // CSPRNG, not Math.random: this is the sole authentication factor, and V8's
  // PRNG state is recoverable from observed outputs. Unused when the SMS
  // provider mints the code itself (2Factor AUTOGEN).
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * argon2id hash for short OTP / exam access codes (CLAUDE.md security rules).
 * Auth login OTP and exam access codes share this helper — do not add a second hasher.
 */
export async function hashOtpCode(code: string): Promise<string> {
  return argon2.hash(code, { type: argon2.argon2id });
}

/** Verify a code against a hash produced by hashOtpCode (argon2id). */
export async function verifyOtpCode(hash: string, code: string): Promise<boolean> {
  if (hash.startsWith("$argon2")) {
    try {
      return await argon2.verify(hash, code);
    } catch {
      return false;
    }
  }
  // Legacy SHA256 OTP hashes from before argon2id (auth code_hash).
  return timingSafeEqualString(hash, hashSecret(code));
}

/**
 * Exam / class access codes: unambiguous alphabet (no O/0/I/1/L), 6 chars,
 * CSPRNG via randomInt.
 */
const EXAM_OTP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateExamAccessCode(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += EXAM_OTP_ALPHABET[randomInt(0, EXAM_OTP_ALPHABET.length)]!;
  }
  return out;
}

/** Constant-time string compare for legacy plaintext exam_otp rows. */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
