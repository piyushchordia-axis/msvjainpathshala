import { z } from "zod";

/** Canonical UUID v4-ish format check used by route params/query guards. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * A URL field that must use the http(s) scheme.
 *
 * Plain `z.string().url()` ACCEPTS dangerous schemes (`javascript:`, `data:`,
 * `vbscript:`) — when such a value is later rendered into an `<a href>` (admin
 * grading/review screens, public library) or opened via `Linking.openURL`, it
 * becomes a stored XSS that crosses a privilege boundary (student → admin).
 * Use this for any user-supplied URL that is later linked/opened.
 */
export function httpUrl(max = 2000) {
  return z
    .string()
    .url()
    .max(max)
    .refine((u) => {
      try {
        const protocol = new URL(u).protocol;
        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    }, "URL must use http(s).");
}

/** Exact hostnames only — never substring/endsWith (blocks youtube.com.evil.tld). */
const VIDEO_EMBED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com",
]);

/**
 * Q7 — true when `u` is an https YouTube/Vimeo URL with an exact hostname match.
 * Shared by Zod schemas and the delivery guard on POST /v1/library/:id/access.
 */
export function isVideoEmbedUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "https:") return false;
    return VIDEO_EMBED_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Q7 — video embeds must be YouTube or Vimeo. Hostname match, never substring. */
export function videoEmbedUrl(max = 2000) {
  return z
    .string()
    .url()
    .max(max)
    .refine((u) => isVideoEmbedUrl(u), {
      message: "Video links must be a YouTube or Vimeo URL.",
    });
}
