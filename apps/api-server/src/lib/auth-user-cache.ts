/**
 * Auth middleware user lookup cache (PERF #13.3).
 * Projects the columns requireAuth / scope actually need — skips fat JSONB.
 * Redis TTL 45s when available; memory fallback otherwise.
 */
import { db, users, type User } from "@workspace/db";
import { eq } from "drizzle-orm";

const AUTH_USER_COLUMNS = {
  id: users.id,
  phone: users.phone,
  email: users.email,
  role: users.role,
  full_name: users.full_name,
  display_code: users.display_code,
  gender: users.gender,
  preferred_language: users.preferred_language,
  state_id: users.state_id,
  city_id: users.city_id,
  centre_id_default: users.centre_id_default,
  is_active: users.is_active,
  last_login_at: users.last_login_at,
  gallery_visibility_opt_in: users.gallery_visibility_opt_in,
  photo_url: users.photo_url,
  deleted_at: users.deleted_at,
  created_at: users.created_at,
  updated_at: users.updated_at,
} as const;

/** AuthUser is User without notification_preferences (loaded as empty default). */
export type AuthUserRow = Omit<User, "notification_preferences"> & {
  notification_preferences: User["notification_preferences"];
};

type CacheEntry = { user: AuthUserRow; expiresAt: number };
const memCache = new Map<string, CacheEntry>();
const TTL_MS = 45_000;

let redisGet: ((key: string) => Promise<string | null>) | null = null;
let redisSet: ((key: string, val: string, mode: string, ttlSec: number) => Promise<unknown>) | null =
  null;
let redisDel: ((key: string) => Promise<unknown>) | null = null;
let redisInitTried = false;

async function ensureRedis(): Promise<void> {
  if (redisInitTried) return;
  redisInitTried = true;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return;
  try {
    const { Redis } = await import("ioredis");
    const client = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    redisGet = (k) => client.get(k);
    redisSet = (k, v, mode, ttl) => client.set(k, v, mode as "EX", ttl);
    redisDel = (k) => client.del(k);
  } catch {
    redisGet = null;
    redisSet = null;
    redisDel = null;
  }
}

function cacheKey(uid: string): string {
  return `auth:user:${uid}`;
}

function toAuthUser(row: Omit<User, "notification_preferences">): AuthUserRow {
  return {
    ...row,
    notification_preferences: {},
  };
}

export async function loadAuthUser(uid: string): Promise<AuthUserRow | null> {
  await ensureRedis();
  const key = cacheKey(uid);

  if (redisGet) {
    try {
      const raw = await redisGet(key);
      if (raw) return JSON.parse(raw) as AuthUserRow;
    } catch {
      /* fail open */
    }
  }
  const hit = memCache.get(uid);
  // A COPY, not the cached instance. lib/scope.ts memoizes resolveAdminScope on
  // the User object identity, documented as "per-request" — but handing back the
  // same instance for 45s made that a cross-request cache of a materialised
  // centre-id list. A city_admin could not touch a centre created in their own
  // city until the TTL expired, and (worse) a REVOKED sanchalak/shikshak
  // assignment kept working just as long. The Redis branch above already returns
  // a fresh object via JSON.parse, which is why this only ever bit deployments
  // without REDIS_URL.
  if (hit && hit.expiresAt > Date.now()) return { ...hit.user };

  const [row] = await db.select(AUTH_USER_COLUMNS).from(users).where(eq(users.id, uid)).limit(1);
  if (!row) return null;

  const user = toAuthUser(row as Omit<User, "notification_preferences">);
  memCache.set(uid, { user, expiresAt: Date.now() + TTL_MS });
  if (redisSet) {
    try {
      await redisSet(key, JSON.stringify(user), "EX", Math.ceil(TTL_MS / 1000));
    } catch {
      /* ignore */
    }
  }
  return user;
}

/** Invalidate after deactivate / role change / self-delete. */
export async function invalidateAuthUserCache(uid: string): Promise<void> {
  memCache.delete(uid);
  await ensureRedis();
  if (redisDel) {
    try {
      await redisDel(cacheKey(uid));
    } catch {
      /* ignore */
    }
  }
}

/** @internal tests */
export function clearAuthUserCache(): void {
  memCache.clear();
}
