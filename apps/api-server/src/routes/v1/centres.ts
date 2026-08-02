/**
 * /v1/centres — public centre resources (AT30 holidays).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, centres, centre_holidays } from "@workspace/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ok, fail } from "../../lib/envelope";

const router: IRouter = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* GET /v1/centres/:id/holidays — public, published only, no auth (AT30) */
router.get("/:id/holidays", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found.");
    return;
  }
  const [centre] = await db
    .select({ id: centres.id })
    .from(centres)
    .where(and(eq(centres.id, id), eq(centres.status, "active"), isNull(centres.deleted_at)))
    .limit(1);
  if (!centre) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found.");
    return;
  }

  const rows = await db
    .select({
      id: centre_holidays.id,
      holiday_date: centre_holidays.holiday_date,
      reason: centre_holidays.reason,
    })
    .from(centre_holidays)
    .where(
      and(
        eq(centre_holidays.centre_id, id),
        eq(centre_holidays.is_published, true),
      ),
    )
    .orderBy(asc(centre_holidays.holiday_date));

  ok(res, { items: rows }, { count: rows.length });
});

export default router;
