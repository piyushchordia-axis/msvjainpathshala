/**
 * AT21 — attendance Punya values from punya_features / city-scoped punya_configs.
 * Never inline a constant. Redis-cached when REDIS_URL is set; memory fallback otherwise.
 */
import { db, punya_configs, punya_features, centres, batches } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

export const ATTENDANCE_FEATURE_KEY = "attendance";

type CacheEntry = { points: number; expiresAt: number };
const memCache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

let redisGet: ((key: string) => Promise<string | null>) | null = null;
let redisSet: ((key: string, val: string, mode: string, ttlSec: number) => Promise<unknown>) | null =
  null;
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
  } catch {
    redisGet = null;
    redisSet = null;
  }
}

async function cacheGet(key: string): Promise<number | null> {
  await ensureRedis();
  if (redisGet) {
    try {
      const raw = await redisGet(key);
      if (raw != null && raw !== "") return Number(raw);
    } catch {
      /* fail open to DB */
    }
  }
  const hit = memCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.points;
  return null;
}

async function cacheSet(key: string, points: number): Promise<void> {
  await ensureRedis();
  memCache.set(key, { points, expiresAt: Date.now() + TTL_MS });
  if (redisSet) {
    try {
      await redisSet(key, String(points), "EX", Math.ceil(TTL_MS / 1000));
    } catch {
      /* ignore */
    }
  }
}

/** Clear caches (tests). */
export function clearAttendancePointsCache(): void {
  memCache.clear();
}

/**
 * Resolve attendance award points for a centre's city (city override → global config
 * → punya_features.max_points when configured). Returns 0 only when nothing is configured.
 */
export async function resolveAttendanceAwardPoints(centreId: string | null): Promise<number> {
  let cityId: string | null = null;
  if (centreId) {
    const [centre] = await db
      .select({ city_id: centres.city_id })
      .from(centres)
      .where(eq(centres.id, centreId))
      .limit(1);
    cityId = centre?.city_id ?? null;
  }

  const cacheKey = `punya:attendance:${cityId ?? "global"}`;
  const cached = await cacheGet(cacheKey);
  if (cached != null && Number.isFinite(cached)) return cached;

  if (cityId) {
    const [cityCfg] = await db
      .select({ points: punya_configs.points })
      .from(punya_configs)
      .where(
        and(
          eq(punya_configs.feature_key, ATTENDANCE_FEATURE_KEY),
          eq(punya_configs.city_id, cityId),
          eq(punya_configs.is_active, true),
        ),
      )
      .limit(1);
    if (cityCfg) {
      await cacheSet(cacheKey, cityCfg.points);
      return cityCfg.points;
    }
  }

  const [globalCfg] = await db
    .select({ points: punya_configs.points })
    .from(punya_configs)
    .where(
      and(
        eq(punya_configs.feature_key, ATTENDANCE_FEATURE_KEY),
        isNull(punya_configs.city_id),
        eq(punya_configs.is_active, true),
      ),
    )
    .limit(1);
  if (globalCfg) {
    await cacheSet(cacheKey, globalCfg.points);
    return globalCfg.points;
  }

  const [feat] = await db
    .select({ max_points: punya_features.max_points, min_points: punya_features.min_points })
    .from(punya_features)
    .where(and(eq(punya_features.key, ATTENDANCE_FEATURE_KEY), eq(punya_features.is_active, true)))
    .limit(1);
  const points = feat?.max_points ?? feat?.min_points ?? 0;
  // Do not cache a zero miss — seed/config may land after the first cold resolve.
  if (points > 0) await cacheSet(cacheKey, points);
  return points;
}

export async function resolveAttendanceAwardPointsForBatch(batchId: string): Promise<{
  points: number;
  centreId: string | null;
}> {
  const [batch] = await db
    .select({ centre_id: batches.centre_id })
    .from(batches)
    .where(eq(batches.id, batchId))
    .limit(1);
  const centreId = batch?.centre_id ?? null;
  const points = await resolveAttendanceAwardPoints(centreId);
  return { points, centreId };
}

/** AT3 — present and late are full attendance Punya; absent/excused/none → 0. */
export function awardValueForStatus(
  status: string | null | undefined,
  configuredPoints: number,
): number {
  if (status === "present" || status === "late") return configuredPoints;
  return 0;
}
