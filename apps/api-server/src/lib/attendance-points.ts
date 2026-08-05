/**
 * AT21 — attendance Punya values from punya_features / city-scoped punya_configs.
 * Never inline a constant. Redis-cached when REDIS_URL is set; memory fallback otherwise.
 *
 * PERF #13 — batch→city mapping is cached (~5m); points cache keys on batch_id so a
 * hot mark path does not re-query centres on every hit. Zero misses stay uncached.
 */
import { db, punya_configs, punya_features, centres, batches } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

export const ATTENDANCE_FEATURE_KEY = "attendance";

type CacheEntry = { points: number; expiresAt: number };
type CityCacheEntry = { centreId: string | null; cityId: string | null; expiresAt: number };

const memCache = new Map<string, CacheEntry>();
const batchCityCache = new Map<string, CityCacheEntry>();
/** ~5 minutes — points/config rarely change mid-session. */
const TTL_MS = 5 * 60_000;

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

async function cityCacheGet(
  batchId: string,
): Promise<{ centreId: string | null; cityId: string | null } | null> {
  await ensureRedis();
  const key = `punya:batch-city:${batchId}`;
  if (redisGet) {
    try {
      const raw = await redisGet(key);
      if (raw) {
        const parsed = JSON.parse(raw) as { centreId: string | null; cityId: string | null };
        return parsed;
      }
    } catch {
      /* fail open */
    }
  }
  const hit = batchCityCache.get(batchId);
  if (hit && hit.expiresAt > Date.now()) {
    return { centreId: hit.centreId, cityId: hit.cityId };
  }
  return null;
}

async function cityCacheSet(
  batchId: string,
  centreId: string | null,
  cityId: string | null,
): Promise<void> {
  await ensureRedis();
  batchCityCache.set(batchId, { centreId, cityId, expiresAt: Date.now() + TTL_MS });
  if (redisSet) {
    try {
      await redisSet(
        `punya:batch-city:${batchId}`,
        JSON.stringify({ centreId, cityId }),
        "EX",
        Math.ceil(TTL_MS / 1000),
      );
    } catch {
      /* ignore */
    }
  }
}

/** Clear caches (tests + punya_configs writes). */
export function clearAttendancePointsCache(): void {
  memCache.clear();
  batchCityCache.clear();
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
  return resolveAttendanceAwardPointsForCity(cityId);
}

async function resolveAttendanceAwardPointsForCity(cityId: string | null): Promise<number> {
  const cacheKey = `punya:attendance:city:${cityId ?? "global"}`;
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
  const batchPointsKey = `punya:attendance:batch:${batchId}`;
  const cachedPoints = await cacheGet(batchPointsKey);

  let centreId: string | null = null;
  let cityId: string | null = null;
  const cachedCity = await cityCacheGet(batchId);
  if (cachedCity) {
    centreId = cachedCity.centreId;
    cityId = cachedCity.cityId;
  } else {
    const [row] = await db
      .select({ centre_id: batches.centre_id, city_id: centres.city_id })
      .from(batches)
      .leftJoin(centres, eq(centres.id, batches.centre_id))
      .where(eq(batches.id, batchId))
      .limit(1);
    centreId = row?.centre_id ?? null;
    cityId = row?.city_id ?? null;
    await cityCacheSet(batchId, centreId, cityId);
  }

  if (cachedPoints != null && Number.isFinite(cachedPoints)) {
    return { points: cachedPoints, centreId };
  }

  const points = await resolveAttendanceAwardPointsForCity(cityId);
  // Key on batch_id so subsequent marks skip city re-resolve entirely.
  if (points > 0) await cacheSet(batchPointsKey, points);
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
