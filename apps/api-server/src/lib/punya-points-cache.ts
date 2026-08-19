/**
 * Shared cache for AT21 point resolution, with cross-instance invalidation.
 *
 * H19 / L9. Five files each carried their own near-identical copy of this
 * Redis-with-memory-fallback boilerplate, and the invalidation was broken in
 * two independent ways:
 *
 *  - `POST /punya/configs` cleared only the attendance and homework caches.
 *    clearExamPointsCache, clearQuizPointsCache and clearCoursePointsCache were
 *    exported and called from nowhere at all, so changing an exam or quiz value
 *    took effect whenever the TTL happened to lapse.
 *  - Every clear function emptied only the in-process Map. `redisDel` was
 *    assigned in attendance-points.ts and never invoked, and the other four had
 *    no delete at all — so with Redis on, the OLD value survived the full TTL on
 *    every instance, including the one that had just been told to forget it.
 *
 * Deleting keys individually cannot fix the second problem: the keys are
 * per-city and per-batch, so an instance cannot know what the others cached.
 * Instead every key is namespaced by a GENERATION counter held in Redis. A
 * config write bumps it once and every previously cached value everywhere
 * becomes unreachable in the same instant; the orphaned keys then expire on
 * their own TTL. No SCAN, no key bookkeeping, no cross-instance chatter.
 *
 * Without Redis the generation lives in-process, which is exactly right for a
 * single-process dev setup.
 */

type Entry<T> = { value: T; expiresAt: number };

let redisGet: ((key: string) => Promise<string | null>) | null = null;
let redisSet:
  | ((key: string, val: string, mode: string, ttlSec: number) => Promise<unknown>)
  | null = null;
let redisIncr: ((key: string) => Promise<number>) | null = null;
let redisInitTried = false;

const GENERATION_KEY = "punya:cfg:gen";
/** Re-read the shared generation at most this often. */
const GENERATION_TTL_MS = 5_000;

let localGeneration = 0;
let generationCache: Entry<number> | null = null;

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
    redisIncr = (k) => client.incr(k);
  } catch {
    redisGet = null;
    redisSet = null;
    redisIncr = null;
  }
}

/**
 * Current cache generation.
 *
 * Briefly cached: re-reading Redis on every point resolution would undo the
 * saving the cache exists to provide. The 5s window is the worst-case delay
 * before an admin's change is visible, against the 5 minutes it used to be.
 */
async function generation(): Promise<number> {
  if (generationCache && generationCache.expiresAt > Date.now()) return generationCache.value;
  await ensureRedis();
  let gen = localGeneration;
  if (redisGet) {
    try {
      const raw = await redisGet(GENERATION_KEY);
      if (raw != null && raw !== "") gen = Number(raw) || 0;
    } catch {
      /* fall back to the local counter */
    }
  }
  generationCache = { value: gen, expiresAt: Date.now() + GENERATION_TTL_MS };
  return gen;
}

/**
 * Invalidate EVERY cached point value, on every instance, at once.
 *
 * Called from the punya config write paths. Deliberately one function rather
 * than five: the previous design required the caller to remember all five, and
 * it remembered two.
 */
export async function bumpPunyaPointsGeneration(): Promise<void> {
  localGeneration += 1;
  generationCache = null;
  await ensureRedis();
  if (redisIncr) {
    try {
      await redisIncr(GENERATION_KEY);
    } catch {
      /* the local bump still clears this instance */
    }
  }
}

/**
 * A namespaced cache for one family of point values.
 *
 * `T` is whatever the caller stores — a number for most resolvers, an object
 * for the course multipliers.
 */
export function createPointsCache<T>(namespace: string, ttlMs: number) {
  const mem = new Map<string, Entry<T>>();

  async function fullKey(key: string): Promise<string> {
    return `punya:g${await generation()}:${namespace}:${key}`;
  }

  return {
    async get(key: string): Promise<T | null> {
      const k = await fullKey(key);
      await ensureRedis();
      if (redisGet) {
        try {
          const raw = await redisGet(k);
          if (raw != null && raw !== "") return JSON.parse(raw) as T;
        } catch {
          /* fail open to the DB */
        }
      }
      const hit = mem.get(k);
      if (hit && hit.expiresAt > Date.now()) return hit.value;
      return null;
    },

    async set(key: string, value: T): Promise<void> {
      const k = await fullKey(key);
      await ensureRedis();
      mem.set(k, { value, expiresAt: Date.now() + ttlMs });
      if (redisSet) {
        try {
          await redisSet(k, JSON.stringify(value), "EX", Math.ceil(ttlMs / 1000));
        } catch {
          /* ignore */
        }
      }
    },

    /** In-process only. Tests use it; config writes must bump the generation. */
    clear(): void {
      mem.clear();
      generationCache = null;
    },
  };
}
