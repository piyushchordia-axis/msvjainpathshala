import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import IORedis from "ioredis";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Liveness: is the process up? Never touches the DB so it stays fast and won't
// flap the container when a dependency is briefly unavailable.
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

async function probeRedis(): Promise<void> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return; // optional in non-prod; production boot already asserts it
  const client = new IORedis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
  });
  try {
    const pong = await client.ping();
    if (pong !== "PONG") throw new Error(`unexpected PING reply: ${pong}`);
  } finally {
    await client.quit().catch(() => client.disconnect());
  }
}

function assertPoolNotSaturated(): void {
  const max = pool.options.max ?? 10;
  // Waiting acquirers while the pool is full → drop out of LB rotation (PERF #19).
  if (pool.waitingCount > 0 && pool.totalCount >= max && pool.idleCount === 0) {
    throw new Error(
      `pg pool saturated (total=${pool.totalCount} max=${max} waiting=${pool.waitingCount})`,
    );
  }
}

// Readiness: DB + Redis (when configured) + pool headroom so a saturated
// instance stops receiving traffic instead of queueing forever.
router.get("/readyz", async (_req, res) => {
  try {
    await pool.query("select 1");
    await probeRedis();
    assertPoolNotSaturated();
    res.status(200).json(HealthCheckResponse.parse({ status: "ready" }));
  } catch (err) {
    logger.error({ err }, "Readiness probe failed");
    res.status(503).json(HealthCheckResponse.parse({ status: "not_ready" }));
  }
});

export default router;
