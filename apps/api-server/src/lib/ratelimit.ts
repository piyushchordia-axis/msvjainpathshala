/**
 * Fixed-window rate limiter for the unauthenticated auth surface (OTP
 * send/verify) and any other hot path that needs cross-instance throttling.
 *
 * Two backends, selected at first use:
 *   - REDIS_URL set  → a lazily-constructed ioredis client with INCR + EXPIRE,
 *     so the window is shared across every API instance behind the load
 *     balancer (the in-memory Map can't see other processes).
 *   - REDIS_URL unset → the exact in-memory Map fixed-window that auth.ts used
 *     inline, so dev/test behaviour is byte-for-byte unchanged and ioredis is
 *     NEVER constructed.
 *
 * In NODE_ENV==='test' the limiter is always a no-op (returns not-limited): the
 * integration suite logs in repeatedly for the same seeded phones.
 *
 * Redis connection/command errors fail OPEN (log loudly + allow) so a Redis
 * outage degrades to "no rate limit" rather than locking every user out of
 * login.
 */
import { logger } from "./logger";

function isTestEnv(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true";
}

// ---------------------------------------------------------------------------
// In-memory fixed-window backend (dev/test, and the fallback when no Redis).
// Behaviour copied verbatim from the previous inline limiter in auth.ts.
// ---------------------------------------------------------------------------
const rlBuckets = new Map<string, { count: number; resetAt: number }>();
function memoryRateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = rlBuckets.get(key);
  if (!b || b.resetAt < now) {
    rlBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  b.count += 1;
  return b.count > max;
}

// ---------------------------------------------------------------------------
// Redis fixed-window backend — only ever touched when REDIS_URL is set.
// ioredis is imported dynamically so the client is never constructed (and the
// module never even loaded) in test/dev where no REDIS_URL exists.
// ---------------------------------------------------------------------------
type RedisLike = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
};

let _redis: RedisLike | undefined;
let _redisDisabled = false;

async function getRedis(): Promise<RedisLike | undefined> {
  if (_redisDisabled) return undefined;
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) return undefined;
  try {
    const { Redis } = await import("ioredis");
    const client = new Redis(url, {
      // Fail fast per command so a Redis outage degrades to fail-open quickly
      // instead of queueing requests until they time out.
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    client.on("error", (err: Error) => {
      // Transient connection errors must not crash the process; the rate-limit
      // call sites already fail open and log on command failure.
      logger.warn({ err: err.message }, "[ratelimit] redis connection error");
    });
    _redis = client as unknown as RedisLike;
    return _redis;
  } catch (err) {
    // ioredis missing or failed to construct — never retry, fail open.
    _redisDisabled = true;
    logger.error({ err }, "[ratelimit] redis init failed; falling back to fail-open");
    return undefined;
  }
}

async function redisRateLimited(
  client: RedisLike,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const count = await client.incr(key);
  // Set the TTL only on the first hit of a fresh window so the window slides
  // forward exactly once per `windowSec`, matching the in-memory resetAt.
  if (count === 1) {
    await client.expire(key, windowSec);
  }
  return count > limit;
}

/**
 * Returns true when `key` is OVER `limit` within the current `windowSec`
 * fixed window (i.e. the caller should reject the request).
 *
 * Always returns false (not limited) in NODE_ENV==='test'. Never throws — a
 * Redis failure is logged and treated as not-limited (fail open).
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  // Integration suite logs in repeatedly — skip unless a test opts in.
  if (isTestEnv() && process.env.JP_TEST_RATE_LIMIT !== "1") return false;
  const client = await getRedis().catch(() => undefined);
  if (!client) {
    return memoryRateLimited(key, limit, windowSec * 1000);
  }
  try {
    return await redisRateLimited(client, key, limit, windowSec);
  } catch (err) {
    // Fail OPEN: a Redis outage must not lock everyone out of login. Log loudly.
    logger.error({ err, key }, "[ratelimit] redis command failed; failing open (request allowed)");
    return false;
  }
}

/** Clear in-memory buckets between rate-limit tests. */
export function resetMemoryRateLimitsForTests(): void {
  rlBuckets.clear();
}

/** Delete a single in-memory key (e.g. clear the per-minute bucket while testing the hourly cap). */
export function clearMemoryRateLimitKeyForTests(key: string): void {
  rlBuckets.delete(key);
}
