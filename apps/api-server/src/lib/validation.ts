import { z } from "zod";

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
