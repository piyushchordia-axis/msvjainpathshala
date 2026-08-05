/**
 * Shared CORS allow-list — Express and Socket.IO must use the same source
 * (PERF #17). Production refuses origins outside CORS_ORIGINS; non-prod
 * reflects any origin for Vite / Expo previews.
 */

export function getAllowedCorsOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Returns true when the Origin header (or absence) is allowed. */
export function isCorsOriginAllowed(origin: string | undefined | null): boolean {
  // Read NODE_ENV at call time so tests can flip production without reload.
  if (process.env.NODE_ENV !== "production") return true;
  if (!origin) return true; // same-origin / non-browser
  return getAllowedCorsOrigins().includes(origin);
}

export function corsOriginDelegate(
  origin: string | undefined,
  cb: (err: Error | null, allow?: boolean) => void,
): void {
  cb(null, isCorsOriginAllowed(origin));
}
