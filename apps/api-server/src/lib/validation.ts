import { z } from "zod";

/**
 * http(s)-only URL field. The implementation moved to `@workspace/api-zod` when
 * the library content-request contract needed the same rule — one definition,
 * so a shared contract and a route guard cannot disagree about what is safe to
 * put in an `<a href>`. Re-exported here because every existing call site
 * imports it from this module.
 */
export { httpUrl } from "@workspace/api-zod";
import { httpUrl } from "@workspace/api-zod";

/** Canonical UUID v4-ish format check used by route params/query guards. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
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

/**
 * v3 §17.1.3 external-link modality: http(s) only, and never a video host.
 *
 * Q7 governs video through youtube_url, which is the only field
 * videoEmbedUrl guards. An unguarded second URL field that accepted YouTube
 * would route video around that rule entirely — the link would reach the
 * client as a plain external document and open in the browser rather than
 * the embed path. The refusal names the right field so the admin is not
 * left guessing.
 */
export function externalDocumentUrl(max = 2000) {
  return httpUrl(max).refine((u) => !isVideoEmbedUrl(u), {
    message: "That is a video link — put YouTube and Vimeo URLs in the video field instead.",
  });
}
