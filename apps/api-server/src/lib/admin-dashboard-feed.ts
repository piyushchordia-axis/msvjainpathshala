/**
 * AT31 — Socket.IO admin feed emits a 10-second windowed aggregate count,
 * not one event per mark (load-test SLO: 5,000 marks / 60s).
 *
 * PERF #17 — Redis adapter (cross-instance emit), JWT + city scope auth,
 * CORS allow-list shared with Express, Redis INCR for cluster-wide counts.
 */
import type { Server as HttpServer } from "node:http";
import IORedis from "ioredis";
import { canAccessAdminPanel, type Role } from "@workspace/api-zod";
import type { User } from "@workspace/db";
import { verifyAccessToken } from "./tokens";
import { loadAuthUser } from "./auth-user-cache";
import { userCanAccessCity } from "./scope";
import { corsOriginDelegate } from "./cors-origins";
import { logger } from "./logger";

export const WINDOW_MS = 10_000;

type CityBucket = { count: number; timer: ReturnType<typeof setTimeout> | null };

/** In-memory fallback when REDIS_URL is unset (dev / test). */
const localBuckets = new Map<string, CityBucket>();
/** Per-process schedule keys so we do not stack timers for the same window. */
const scheduledWindows = new Set<string>();

let io: import("socket.io").Server | null = null;
let feedRedis: IORedis | null = null;
let adapterPub: IORedis | null = null;
let adapterSub: IORedis | null = null;

/** @internal — deterministic AT31 window key (Redis + tests). */
export function adminFeedAggregateKey(cityId: string, now = Date.now()): string {
  const bucket = Math.floor(now / WINDOW_MS);
  return `admin_feed:agg:${cityId}:${bucket}`;
}

function getFeedRedis(): IORedis | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (!feedRedis) {
    feedRedis = new IORedis(url, { maxRetriesPerRequest: null });
    feedRedis.on("error", (err) => logger.warn({ err }, "admin feed Redis error"));
  }
  return feedRedis;
}

async function takeWindowCount(redis: IORedis, key: string): Promise<number> {
  // GETDEL when available; otherwise GET+DEL in a pipeline.
  if (typeof redis.getdel === "function") {
    const raw = await redis.getdel(key);
    return Number(raw ?? 0);
  }
  const [[, raw]] = (await redis.multi().get(key).del(key).exec()) as [
    [Error | null, string | null],
    [Error | null, number],
  ];
  return Number(raw ?? 0);
}

function emitAggregate(cityId: string, count: number): void {
  if (count <= 0) return;
  io?.of("/admin-dashboard").to(`city:${cityId}`).emit("attendance.marks_aggregate", {
    city_id: cityId,
    count,
    window_ms: WINDOW_MS,
  });
}

function scheduleWindowFlush(cityId: string, key: string, flush: () => void): void {
  if (scheduledWindows.has(key)) return;
  scheduledWindows.add(key);
  const remaining = WINDOW_MS - (Date.now() % WINDOW_MS);
  const timer = setTimeout(() => {
    scheduledWindows.delete(key);
    flush();
  }, remaining === 0 ? WINDOW_MS : remaining);
  if (typeof timer === "object" && "unref" in timer) {
    (timer as NodeJS.Timeout).unref();
  }
}

/**
 * Extract bearer token from Socket.IO handshake — CLAUDE.md: auth: { token }.
 * Also accepts Authorization header for non-browser clients.
 */
export function extractSocketAccessToken(handshake: {
  auth?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}): string | null {
  const fromAuth = handshake.auth?.token;
  if (typeof fromAuth === "string" && fromAuth.length > 0) return fromAuth;
  const header = handshake.headers?.authorization ?? handshake.headers?.Authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

/** @internal — shared auth gate for tests and namespace middleware. */
export async function authenticateAdminDashboardSocket(handshake: {
  auth?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
}): Promise<{ user: User; cityId: string } | { error: string }> {
  const token = extractSocketAccessToken(handshake);
  if (!token) return { error: "unauthenticated" };
  const verified = verifyAccessToken(token);
  if (!verified) return { error: "invalid_token" };
  const user = await loadAuthUser(verified.uid);
  if (!user || !user.is_active || user.deleted_at) return { error: "inactive" };
  if (!canAccessAdminPanel(user.role as Role)) return { error: "forbidden" };

  const cityRaw = handshake.query?.cityId ?? handshake.query?.city_id;
  const cityId = typeof cityRaw === "string" ? cityRaw : Array.isArray(cityRaw) ? String(cityRaw[0] ?? "") : "";
  if (!cityId) return { error: "city_required" };
  if (!(await userCanAccessCity(user as User, cityId))) return { error: "city_forbidden" };
  return { user: user as User, cityId };
}

export function attachAdminDashboardFeed(httpServer: HttpServer): void {
  void Promise.all([import("socket.io"), import("@socket.io/redis-adapter")])
    .then(async ([{ Server }, { createAdapter }]) => {
      const redis = getFeedRedis();
      io = new Server(httpServer, {
        path: "/socket.io",
        cors: {
          origin: corsOriginDelegate,
          credentials: true,
        },
      });

      if (redis) {
        adapterPub = redis.duplicate();
        adapterSub = redis.duplicate();
        io.adapter(createAdapter(adapterPub, adapterSub));
        logger.info("Socket.IO Redis adapter attached");
      } else {
        logger.warn("REDIS_URL unset — Socket.IO admin feed is single-process only");
      }

      const nsp = io.of("/admin-dashboard");
      nsp.use(async (socket, next) => {
        const result = await authenticateAdminDashboardSocket(socket.handshake);
        if ("error" in result) {
          next(new Error(result.error));
          return;
        }
        socket.data.user = result.user;
        socket.data.cityId = result.cityId;
        next();
      });

      nsp.on("connection", (socket) => {
        const cityId = String(socket.data.cityId ?? "");
        if (cityId) socket.join(`city:${cityId}`);
      });

      logger.info("Socket.IO admin-dashboard namespace ready");
    })
    .catch((err) => {
      logger.warn({ err }, "socket.io unavailable; admin feed aggregates are in-memory only");
    });
}

/**
 * Record one mark toward the AT31 window. Prefers Redis INCR so counts are
 * cluster-wide; falls back to per-process memory when Redis is absent.
 */
export function recordAdminAttendanceMark(cityId: string): void {
  if (!cityId) return;
  const redis = getFeedRedis();
  if (redis) {
    const key = adminFeedAggregateKey(cityId);
    void redis
      .incr(key)
      .then(async (n) => {
        if (n === 1) {
          await redis.expire(key, Math.ceil(WINDOW_MS / 1000) + 60);
        }
        scheduleWindowFlush(cityId, key, () => {
          void takeWindowCount(redis, key)
            .then((count) => emitAggregate(cityId, count))
            .catch((err) => logger.warn({ err, cityId }, "admin feed flush failed"));
        });
      })
      .catch((err) => logger.warn({ err, cityId }, "admin feed incr failed"));
    return;
  }

  let bucket = localBuckets.get(cityId);
  if (!bucket) {
    bucket = { count: 0, timer: null };
    localBuckets.set(cityId, bucket);
  }
  bucket.count += 1;
  if (!bucket.timer) {
    bucket.timer = setTimeout(() => {
      const b = localBuckets.get(cityId);
      if (!b) return;
      const count = b.count;
      b.count = 0;
      b.timer = null;
      emitAggregate(cityId, count);
    }, WINDOW_MS);
    if (typeof bucket.timer === "object" && "unref" in bucket.timer) {
      (bucket.timer as NodeJS.Timeout).unref();
    }
  }
}

/** @internal — test helper: read the Redis-backed counter without flushing. */
export async function peekAdminFeedAggregate(cityId: string, now = Date.now()): Promise<number | null> {
  const redis = getFeedRedis();
  if (!redis) return null;
  const raw = await redis.get(adminFeedAggregateKey(cityId, now));
  return raw == null ? 0 : Number(raw);
}
