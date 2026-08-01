/**
 * Short-lived signed URLs for /uploads files.
 *
 * /uploads holds sensitive, server-generated artifacts (progress-report PDFs
 * with a child's data, ID-card PNGs) and user proof images. Serving them via
 * anonymous static made them world-readable by URL. Instead the file route now
 * requires a valid HMAC signature, and every API response that hands back an
 * /uploads URL signs it (`signUploadUrl`) with a short TTL. Cookie auth can't
 * gate `<img>`/`<a>` cross-origin (SameSite) and Bearer can't ride on an <img>,
 * so signed URLs are the right primitive (same model as S3 presigned URLs).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = (() => {
  const fromEnv = process.env.JP_AUTH_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JP_AUTH_SECRET is required in production.");
  }
  return "jp-dev-secret-do-not-use-in-production";
})();

const DOMAIN = "upload-url-v1";
/** Spec §10.3 — 1h default (gallery hands these to anonymous callers for minors). */
const TTL_SECONDS = Number(process.env.UPLOAD_URL_TTL_SECONDS ?? 3600);

function sign(key: string, exp: number): string {
  return createHmac("sha256", SECRET).update(`${DOMAIN}\n${key}\n${exp}`).digest("base64url");
}

/** Extract the storage key from one of OUR /uploads URLs, or null if external. */
export function uploadKeyFromUrl(url: string): string | null {
  const marker = "/uploads/";
  const i = url.indexOf(marker);
  if (i < 0) return null;
  const rest = url.slice(i + marker.length).split("?")[0];
  try {
    return rest.split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

/**
 * If `url` points to our /uploads storage, append a short-lived signature so the
 * /uploads route will serve it; otherwise return it unchanged (external URLs,
 * e.g. admin-pasted library links, are not ours to sign). Safe to call on any
 * URL-ish field.
 *
 * @param ttlSeconds Optional per-call override (e.g. long-lived progress-report PDFs).
 */
export function signUploadUrl<T extends string | null | undefined>(
  url: T,
  ttlSeconds?: number,
): T {
  if (!url) return url;
  const key = uploadKeyFromUrl(url);
  if (key === null) return url;
  const ttl = ttlSeconds ?? TTL_SECONDS;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = sign(key, exp);
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}se=${exp}&sig=${sig}` as T;
}

/** Verify a request for /uploads/<key> carries a valid, unexpired signature. */
export function verifyUploadAccess(key: string, se: string, sig: string): boolean {
  const exp = Number(se);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(key, exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
