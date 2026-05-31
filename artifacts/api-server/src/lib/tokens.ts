import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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

const ACCESS_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
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
  // 6-digit numeric, zero-padded
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}
