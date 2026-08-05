/**
 * Production boot guards for queue infrastructure.
 * Kept separate from index.ts listen so tests can assert without binding a port.
 */
export function assertProductionRedisConfigured(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.REDIS_URL?.trim()) return;
  throw new Error(
    "REDIS_URL is required in production; refusing to start without Redis: " +
      "queue work would run inline in the request path, which is quadratic in marks per session",
  );
}
