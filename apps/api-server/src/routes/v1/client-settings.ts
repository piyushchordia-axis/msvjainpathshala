/**
 * Public (anonymous) read of allowlisted client-facing settings.
 * Mounted at /v1/settings/public — never returns the full settings table.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, settings } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { ok } from "../../lib/envelope";
import { CLIENT_SETTINGS_ALLOWLIST } from "../../lib/client-settings";

const router: IRouter = Router();

/* GET /v1/settings/public */
router.get("/", async (_req: Request, res: Response) => {
  const keys = [...CLIENT_SETTINGS_ALLOWLIST];
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, keys));

  ok(res, {
    items: rows.map((r) => ({ key: r.key, value: r.value ?? "" })),
  }, { count: rows.length });
});

export default router;
