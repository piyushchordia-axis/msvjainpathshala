import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Liveness: is the process up? Never touches the DB so it stays fast and won't
// flap the container when a dependency is briefly unavailable.
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Readiness: can we actually serve traffic? Runs a real DB probe so a
// DB-down container reports not-ready (503) instead of falsely healthy.
router.get("/readyz", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.status(200).json(HealthCheckResponse.parse({ status: "ready" }));
  } catch (err) {
    logger.error({ err }, "Readiness probe failed: database unreachable");
    res.status(503).json(HealthCheckResponse.parse({ status: "not_ready" }));
  }
});

export default router;
