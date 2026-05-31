import { Router, type IRouter, type Request, type Response } from "express";
import { db, notices } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { ok } from "../../lib/envelope";

const router: IRouter = Router();

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/* GET /v1/notices/public?limit= */
router.get("/public", async (req: Request, res: Response) => {
  const limit = clampLimit(req.query.limit, 50, 200);
  const rows = await db
    .select({
      id: notices.id,
      title_en: notices.title_en,
      title_hi: notices.title_hi,
      content_en: notices.content_en,
      content_hi: notices.content_hi,
      pinned: notices.pinned,
      is_critical: notices.is_critical,
      created_at: notices.created_at,
    })
    .from(notices)
    .where(eq(notices.is_public, true))
    .orderBy(desc(notices.pinned), desc(notices.published_at), desc(notices.created_at))
    .limit(limit);

  const items = rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
  ok(res, { items }, { count: items.length });
  void and;
});

export default router;
