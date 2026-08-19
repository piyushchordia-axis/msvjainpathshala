/**
 * AT21 — attendance Punya values from punya_features / city-scoped punya_configs.
 * Never inline a constant. Redis-cached when REDIS_URL is set; memory fallback otherwise.
 *
 * PERF #13 — batch→city mapping is cached (~5m); points cache keys on batch_id so a
 * hot mark path does not re-query centres on every hit. Zero misses stay uncached.
 */
import { db, punya_configs, punya_features, centres, batches } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";

export const ATTENDANCE_FEATURE_KEY = "attendance";

/**
 * Last resort when the catalogue is cold, matching DEFAULT_COMPLETION in
 * exam-points.ts and DEFAULT_APPROVED in homework-points.ts.
 *
 * C2: this resolver was the only one of the four with no hardcoded floor,
 * and no migration ever registered the `attendance` feature. It returned 0,
 * awardValueForStatus returned 0, and attendance-mark.ts short-circuited on
 * `amount <= 0` without writing a ledger row — so a full roster marked
 * present awarded nothing, silently. Migration 0088 now seeds the row; this
 * floor is the belt to that migration's braces, so a truncated or
 * half-restored catalogue degrades to the documented value, not to silence.
 */
const DEFAULT_ATTENDANCE = 10;

/** AT22 — the repeating every-4-sessions bonus. */
export const ATTENDANCE_STREAK_FEATURE_KEY = "attendance_streak";

/**
 * Matches migration 0012's punya_features/punya_configs rows (20/20).
 * Only reached when the catalogue is cold — see DEFAULT_ATTENDANCE.
 */
const DEFAULT_STREAK_BONUS = 20;

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
 * → punya_features bounds → DEFAULT_ATTENDANCE). Never returns 0 for a cold
 * catalogue — see C2 and migration 0088.
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

/**
 * Generic AT21 resolution for one feature key: city override → global config
 * → punya_features bounds → the caller's hardcoded floor.
 *
 * Extracted from the attendance-only version so the streak bonus (H8) resolves
 * through the same precedence and the same cache instead of an inlined constant.
 */
async function resolveFeatureDefaultPoints(
  featureKey: string,
  cityId: string | null,
  fallback: number,
): Promise<number> {
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
  const points = fromFeature != null && fromFeature > 0 ? fromFeature : fallback;
  await cacheSet(cacheKey, points);
  return points;
}

async function resolveAttendanceAwardPointsForCity(cityId: string | null): Promise<number> {
  return resolveFeatureDefaultPoints(ATTENDANCE_FEATURE_KEY, cityId, DEFAULT_ATTENDANCE);
}

/**
 * AT21 — the streak bonus, resolved from the catalogue like every other
 * point value.
 *
 * H8: this was the constant STREAK_BONUS_POINTS = 20 inlined in
 * attendance-post-process.ts, while migration 0012 seeded a
 * punya_configs('attendance_streak', 20) row that admin-modules.ts let an
 * admin edit. Nothing read it. Raising the bonus to 30 updated the row,
 * returned success, and changed nothing, forever — a control that looks
 * functional and is inert is worse than a missing one.
 */
export async function resolveStreakBonusPoints(cityId: string | null): Promise<number> {
  return resolveFeatureDefaultPoints(
    ATTENDANCE_STREAK_FEATURE_KEY,
    cityId,
    DEFAULT_STREAK_BONUS,
  );
}

/** Streak bonus for a batch, resolving the batch's city through the same cache. */
export async function resolveStreakBonusPointsForBatch(batchId: string): Promise<number> {
  const { cityId } = await resolveBatchGeography(batchId);
  return resolveStreakBonusPoints(cityId);
}

/** PERF #13 — batch —> (centre, city), cached ~5m. */
export async function resolveBatchGeography(
  batchId: string,
): Promise<{ centreId: string | null; cityId: string | null }> {
  const cachedCity = await cityCacheGet(batchId);
  if (cachedCity) {
    return { centreId: cachedCity.centreId, cityId: cachedCity.cityId };
  }
  const [row] = await db
    .select({ centre_id: batches.centre_id, city_id: centres.city_id })
    .from(batches)
    .leftJoin(centres, eq(centres.id, batches.centre_id))
    .where(eq(batches.id, batchId))
    .limit(1);
  const centreId = row?.centre_id ?? null;
  const cityId = row?.city_id ?? null;
  await cityCacheSet(batchId, centreId, cityId);
  return { centreId, cityId };
}

export async function resolveAttendanceAwardPointsForBatch(batchId: string): Promise<{
  points: number;
  centreId: string | null;
}> {
  const batchPointsKey = `punya:attendance:batch:${batchId}`;
  const cachedPoints = await cacheGet(batchPointsKey);

  const { centreId, cityId } = await resolveBatchGeography(batchId);

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
