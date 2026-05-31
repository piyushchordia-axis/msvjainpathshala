import { Router, type IRouter, type Request, type Response } from "express";
import { db, gallery_items, students, niyams } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { ok } from "../../lib/envelope";

const router: IRouter = Router();

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

/* GET /v1/gallery?limit= */
router.get("/", async (req: Request, res: Response) => {
  const limit = clampLimit(req.query.limit, 60, 200);
  const rows = await db
    .select({
      id: gallery_items.id,
      full_name: students.full_name,
      age_group: students.age_group,
      niyam_title_en: niyams.title_en,
      niyam_title_hi: niyams.title_hi,
      niyam_type: niyams.niyam_type,
      is_featured: gallery_items.is_featured,
      created_at: gallery_items.created_at,
    })
    .from(gallery_items)
    .innerJoin(students, eq(students.id, gallery_items.student_id))
    .innerJoin(niyams, eq(niyams.id, gallery_items.niyam_id))
    .where(eq(gallery_items.is_public, true))
    .orderBy(desc(gallery_items.is_featured), desc(gallery_items.created_at))
    .limit(limit);

  const items = rows.map((r) => ({
    id: r.id,
    first_name: firstName(r.full_name),
    age_group: r.age_group,
    niyam_title_en: r.niyam_title_en,
    niyam_title_hi: r.niyam_title_hi,
    niyam_type: r.niyam_type,
    is_featured: r.is_featured,
    created_at: r.created_at.toISOString(),
  }));
  ok(res, { items }, { count: items.length });
  void and;
});

export default router;
