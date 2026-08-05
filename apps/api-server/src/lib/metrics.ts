/**
 * Prometheus metrics (PERF #19). Scraped from /metrics (loopback or METRICS_TOKEN).
 */
import client from "prom-client";
import type { Request, Response, NextFunction } from "express";
import { pool, workerPool } from "@workspace/db";
import { QUEUE_NAMES } from "@jp/shared/constants";
import { getQueueJobCounts } from "./queues";
import { fail } from "./envelope";

client.collectDefaultMetrics({ register: client.register });

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

new client.Gauge({
  name: "pg_pool_connections",
  help: "pg pool connection counts by state",
  labelNames: ["pool", "state"] as const,
  collect() {
    for (const [name, p] of [
      ["api", pool],
      ["worker", workerPool],
    ] as const) {
      this.set({ pool: name, state: "total" }, p.totalCount);
      this.set({ pool: name, state: "idle" }, p.idleCount);
      this.set({ pool: name, state: "waiting" }, p.waitingCount);
    }
  },
});

new client.Gauge({
  name: "bullmq_jobs_waiting",
  help: "BullMQ waiting + delayed jobs",
  labelNames: ["queue"] as const,
  async collect() {
    for (const name of Object.values(QUEUE_NAMES)) {
      const counts = await getQueueJobCounts(name);
      this.set({ queue: name }, (counts?.waiting ?? 0) + (counts?.delayed ?? 0));
    }
  },
});

new client.Gauge({
  name: "bullmq_jobs_failed",
  help: "BullMQ failed jobs retained",
  labelNames: ["queue"] as const,
  async collect() {
    for (const name of Object.values(QUEUE_NAMES)) {
      const counts = await getQueueJobCounts(name);
      this.set({ queue: name }, counts?.failed ?? 0);
    }
  },
});

/** Collapse UUIDs / numeric ids so cardinality stays bounded. */
export function metricsRouteLabel(req: Request): string {
  const base = `${req.baseUrl ?? ""}${req.route?.path ?? req.path ?? ""}` || "unknown";
  return base
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ":id",
    )
    .replace(/\/\d+/g, "/:id");
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    end({
      method: req.method,
      route: metricsRouteLabel(req),
      status_code: String(res.statusCode),
    });
  });
  next();
}

/** Internal scrape only — loopback or shared METRICS_TOKEN. */
export function requireMetricsAccess(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.METRICS_TOKEN?.trim();
  const provided =
    (typeof req.headers["x-metrics-token"] === "string"
      ? req.headers["x-metrics-token"]
      : undefined) ??
    (typeof req.headers.authorization === "string" &&
    req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : undefined);
  if (expected && provided === expected) {
    next();
    return;
  }
  const ip = req.ip || req.socket.remoteAddress || "";
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
    next();
    return;
  }
  fail(res, 403, "ERR_FORBIDDEN", "Metrics are internal-only.");
}

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.setHeader("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
}
