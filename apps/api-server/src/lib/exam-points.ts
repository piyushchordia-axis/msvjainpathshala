/**
 * AT21 — exam Punya values from punya_features / city-scoped punya_configs.
 * Per-exam completion_points / top_score_points are overrides only (NULL → feature default).
 */
import { db, punya_configs, punya_features } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

export const EXAM_COMPLETION_FEATURE_KEY = "exam_completion";
export const EXAM_TOP_SCORE_FEATURE_KEY = "exam_top_score";

/** Last-resort defaults when the catalogue row is missing (matches migration seed). */
const DEFAULT_COMPLETION = 20;
const DEFAULT_TOP_SCORE = 50;

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
export function clearExamPointsCache(): void {
  memCache.clear();
}

async function resolveFeatureDefault(
  featureKey: string,
  cityId: string | null,
  hardcoded: number,
): Promise<number> {
  const cacheKey = `punya:${featureKey}:${cityId ?? "global"}`;
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
    .limit(1);
  if (globalCfg) {
    await cacheSet(cacheKey, globalCfg.points);
    return globalCfg.points;
  }

  const [feat] = await db
    .select({ max_points: punya_features.max_points, min_points: punya_features.min_points })
    .from(punya_features)
    .where(and(eq(punya_features.key, featureKey), eq(punya_features.is_active, true)))
    .limit(1);
  const fromFeature = feat?.max_points ?? feat?.min_points ?? null;
  const points = fromFeature != null && fromFeature > 0 ? fromFeature : hardcoded;
  await cacheSet(cacheKey, points);
  return points;
}

/**
 * Resolve completion points for a city.
 * `override` from online_exams.completion_points: null → feature default; 0 → disabled.
 */
export async function resolveExamCompletionPoints(
  cityId: string | null,
  override: number | null | undefined,
): Promise<number> {
  if (override != null) return Math.max(0, override);
  return resolveFeatureDefault(EXAM_COMPLETION_FEATURE_KEY, cityId, DEFAULT_COMPLETION);
}

/**
 * Resolve top-score points for a city.
 * `override` from online_exams.top_score_points: null → feature default; 0 → disabled.
 */
export async function resolveExamTopScorePoints(
  cityId: string | null,
  override: number | null | undefined,
): Promise<number> {
  if (override != null) return Math.max(0, override);
  return resolveFeatureDefault(EXAM_TOP_SCORE_FEATURE_KEY, cityId, DEFAULT_TOP_SCORE);
}
