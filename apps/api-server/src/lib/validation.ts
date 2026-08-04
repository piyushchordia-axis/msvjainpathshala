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
