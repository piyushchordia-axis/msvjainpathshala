/**
 * AT21 — role ceilings for manual admin Punya awards.
 * Redis-with-memory-fallback cache (same pattern as exam-points.ts).
 */
import { db, punya_award_limits, punya_features, punya_transactions } from "@workspace/db";
import { and, eq, gt, sql } from "drizzle-orm";

export const MANUAL_AWARD_FEATURE_KEY = "manual_award";

export interface AwardLimit {
  maxPerAward: number;
  maxPerDay: number | null;
}

type CacheEntry = { value: AwardLimit; expiresAt: number };
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

async function cacheGet(key: string): Promise<AwardLimit | null> {
  await ensureRedis();
  if (redisGet) {
    try {
      const raw = await redisGet(key);
      if (raw != null && raw !== "") {
        const parsed = JSON.parse(raw) as AwardLimit;
        if (typeof parsed.maxPerAward === "number") return parsed;
      }
    } catch {
      /* fail open to DB */
    }
  }
  const hit = memCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  return null;
}

async function cacheSet(key: string, value: AwardLimit): Promise<void> {
  await ensureRedis();
  memCache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  if (redisSet) {
    try {
      await redisSet(key, JSON.stringify(value), "EX", Math.ceil(TTL_MS / 1000));
    } catch {
      /* ignore */
    }
  }
}

/** Clear caches (tests). */
export function clearAwardLimitCache(): void {
  memCache.clear();
}

async function featureMaxPoints(): Promise<number | null> {
  const [row] = await db
    .select({ max_points: punya_features.max_points })
    .from(punya_features)
    .where(and(eq(punya_features.key, MANUAL_AWARD_FEATURE_KEY), eq(punya_features.is_active, true)))
    .limit(1);
  if (row?.max_points == null) return null;
  return row.max_points;
}

/**
 * Resolve the caller's award ceiling.
 * Role row (active) → punya_features.max_points for manual_award → 0.
 * Never inline a constant.
 */
export async function resolveAwardLimit(role: string): Promise<AwardLimit> {
  const cacheKey = `punya:award_limit:${role}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const [row] = await db
    .select({
      max_points_per_award: punya_award_limits.max_points_per_award,
      max_points_per_day: punya_award_limits.max_points_per_day,
    })
    .from(punya_award_limits)
    .where(and(eq(punya_award_limits.role, role), eq(punya_award_limits.is_active, true)))
    .limit(1);

  let limit: AwardLimit;
  if (row) {
    limit = {
      maxPerAward: row.max_points_per_award,
      maxPerDay: row.max_points_per_day,
    };
  } else {
    const featureMax = await featureMaxPoints();
    limit = {
      maxPerAward: featureMax ?? 0,
      maxPerDay: null,
    };
  }

  await cacheSet(cacheKey, limit);
  return limit;
}

/**
 * Sum of manual_award credits by this user since start of today (Asia/Kolkata).
 */
export async function pointsAwardedTodayBy(userId: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${punya_transactions.points}), 0)::int`,
    })
    .from(punya_transactions)
    .where(
      and(
        eq(punya_transactions.awarded_by, userId),
        eq(punya_transactions.feature_key, MANUAL_AWARD_FEATURE_KEY),
        gt(punya_transactions.points, 0),
        sql`(${punya_transactions.created_at} AT TIME ZONE 'Asia/Kolkata')::date
            = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date`,
      ),
    );
  return row?.total ?? 0;
}
