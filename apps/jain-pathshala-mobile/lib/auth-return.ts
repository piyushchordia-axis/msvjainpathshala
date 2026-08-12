import type { Href } from "expo-router";

/**
 * Only in-app paths (leading `/`, no scheme) may be used as post-login return
 * targets — blocks open redirects via `https://…` or `javascript:`.
 */
export function safeReturnTo(raw: string | null | undefined): Href | null {
  if (!raw || typeof raw !== "string") return null;
  const path = raw.trim();
  if (!path.startsWith("/")) return null;
  if (path.startsWith("//")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return null;
  return path as Href;
}
