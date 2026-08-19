/**
 * AT21 — homework Punya values from punya_features / city-scoped punya_configs.
 * Never inline a constant. Redis-cached when REDIS_URL is set; memory fallback otherwise.
 *
 * Approved and starred are separate feature keys (not a hardcoded multiplier) so
 * admins can tune each without a deploy.
 *
 * PERF #13 — same batch→city + batch-keyed points cache as attendance-points.
 */
import { db, punya_configs, punya_features, centres, batches } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";

export const HOMEWORK_FEATURE_KEY = "homework";
export const HOMEWORK_STARRED_FEATURE_KEY = "homework_starred";

/** Last-resort defaults when features are missing (matches seed / migration). */
const DEFAULT_APPROVED = 10;
const DEFAULT_STARRED = 12;

type CacheEntry = { points: number; expiresAt: number };
type CityCacheEntry = { centreId: string | null; cityId: string | null; expiresAt: number };

const memCache = new Map<string, CacheEntry>();
const batchCityCache = new Map<string, CityCacheEntry>();
const TTL_MS = 5 * 60_000;

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

async function cityCacheGet(
  batchId: string,
): Promise<{ centreId: string | null; cityId: string | null } | null> {
  await ensureRedis();
  const key = `punya:batch-city:${batchId}`;
  if (redisGet) {
    try {
      const raw = await redisGet(key);
      if (raw) {
        return JSON.parse(raw) as { centreId: string | null; cityId: string | null };
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
export function clearHomeworkPointsCache(): void {
  memCache.clear();
  batchCityCache.clear();
}

function featureKeyForStatus(status: "approved" | "starred"): string {
  return status === "starred" ? HOMEWORK_STARRED_FEATURE_KEY : HOMEWORK_FEATURE_KEY;
}

function hardcodedDefault(status: "approved" | "starred"): number {
  return status === "starred" ? DEFAULT_STARRED : DEFAULT_APPROVED;
}

/**
 * Resolve homework award points for a centre's city
 * (city override → global config → punya_features.max_points → hardcoded default).
 */
export async function resolveHomeworkAwardPoints(
  status: "approved" | "starred",
  centreId: string | null,
): Promise<number> {
  let cityId: string | null = null;
  if (centreId) {
    const [centre] = await db
      .select({ city_id: centres.city_id })
      .from(centres)
      .where(eq(centres.id, centreId))
      .limit(1);
    cityId = centre?.city_id ?? null;
  }
  return resolveHomeworkAwardPointsForCity(status, cityId);
}

async function resolveHomeworkAwardPointsForCity(
  status: "approved" | "starred",
  cityId: string | null,
): Promise<number> {
  const featureKey = featureKeyForStatus(status);
  const cacheKey = `punya:${featureKey}:city:${cityId ?? "global"}`;
  const cached = await cacheGet(cacheKey);
  if (cached != null && Number.isFinite(cached)) return cached;

  if (cityId) {
    const [cityCfg] = await db
      .select({ points: punya_configs.points })
      .from(punya_configs)
      .where(
        and(
          eq(punya_configs.feature_key, featureKey),
          eq(punya_configs.city_id, cityId),
          eq(punya_configs.is_active, true),
        ),
      )
      .orderBy(desc(punya_configs.updated_at), desc(punya_configs.id))
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
        eq(punya_configs.feature_key, featureKey),
        isNull(punya_configs.city_id),
        eq(punya_configs.is_active, true),
      ),
    )
    .orderBy(desc(punya_configs.updated_at), desc(punya_configs.id))
    .limit(1);
  if (globalCfg) {
    await cacheSet(cacheKey, globalCfg.points);
    return globalCfg.points;
  }

  const [feat] = await db
    .select({ max_points: punya_features.max_points, min_points: punya_features.min_points })
    .from(punya_features)
    .where(and(eq(punya_features.key, featureKey), eq(punya_features.is_active, true)))
    .orderBy(desc(punya_features.updated_at), desc(punya_features.id))
    .limit(1);
  const fromFeature = feat?.max_points ?? feat?.min_points ?? null;
  const points = fromFeature != null && fromFeature > 0 ? fromFeature : hardcodedDefault(status);
  await cacheSet(cacheKey, points);
  return points;
}

export async function resolveHomeworkAwardPointsForBatch(
  status: "approved" | "starred",
  batchId: string,
): Promise<{ points: number; centreId: string | null }> {
  const featureKey = featureKeyForStatus(status);
  const batchPointsKey = `punya:${featureKey}:batch:${batchId}`;
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

  const points = await resolveHomeworkAwardPointsForCity(status, cityId);
  await cacheSet(batchPointsKey, points);
  return { points, centreId };
}
