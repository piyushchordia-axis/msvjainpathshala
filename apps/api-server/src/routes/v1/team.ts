/**
 * Public Team directory — no auth.
 * GET /v1/team
 * GET /v1/team/cities/:citySlug?page=N
 * GET /v1/team/cities/:citySlug/shikshaks?cursor= | ?page=N
 * GET /v1/team/centres/:centreId
 * GET /v1/team/city-slugs — generateStaticParams / prerender source
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { ok, fail } from "../../lib/envelope";
import { rateLimit } from "../../lib/ratelimit";
import sharp from "sharp";
import { renderJainTeamPortraitSvg } from "../../lib/team-portrait-svg";
import {
  SHIKSHAK_CENTRES_PAGE_SIZE,
  buildCentreTeamPayload,
  buildCityTeamPayload,
  buildNationalTeamPayload,
  cityHasPublishedMembers,
  decodeCentreCursor,
  listPublishedTeamCitySlugs,
  loadShikshakCentrePage,
  resolveCityBySlug,
} from "../../lib/team-public";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clientIp(req: Request): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) return xf.split(",")[0]!.trim();
  return req.ip || "unknown";
}

/** Shared public Team rate limit — Redis sliding window. */
async function teamRateLimited(req: Request, res: Response): Promise<boolean> {
  const ip = clientIp(req);
  if (await rateLimit(`team:public:ip:${ip}`, 60, 60)) {
    fail(res, 429, "ERR_RATE_LIMITED", "Too many Team requests — wait a minute and try again.");
    return true;
  }
  return false;
}

function parsePage(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), 10_000);
}

/* GET /v1/team/portraits/:memberId — illustrated Jain-person placeholder (PNG) */
router.get("/portraits/:memberId", async (req: Request, res: Response) => {
  const memberId = String(req.params.memberId ?? "").replace(/\.(svg|png)$/i, "");
  if (!UUID_RE.test(memberId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Portrait not found.");
    return;
  }
  const g = String(req.query.g ?? "");
  const gender = g === "f" ? "female" : g === "m" ? "male" : null;
  const svg = Buffer.from(renderJainTeamPortraitSvg(memberId, gender));
  const png = await sharp(svg).png().toBuffer();
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  res.send(png);
});

/* GET /v1/team — national + state members, city index */
router.get("/", async (req: Request, res: Response) => {
  if (await teamRateLimited(req, res)) return;
  const data = await buildNationalTeamPayload();
  ok(res, data);
});

/* GET /v1/team/city-slugs — cities with published members (static params) */
router.get("/city-slugs", async (req: Request, res: Response) => {
  if (await teamRateLimited(req, res)) return;
  const slugs = await listPublishedTeamCitySlugs();
  ok(res, { slugs });
});

/* GET /v1/team/cities/:citySlug?page=N */
router.get("/cities/:citySlug", async (req: Request, res: Response) => {
  if (await teamRateLimited(req, res)) return;
  const slug = String(req.params.citySlug ?? "").trim().toLowerCase();
  if (!slug) {
    fail(res, 404, "ERR_NOT_FOUND", "City not found.");
    return;
  }

  const city = await resolveCityBySlug(slug);
  if (!city || !(await cityHasPublishedMembers(city.id))) {
    fail(res, 404, "ERR_NOT_FOUND", "City not found, or it has no published Team members yet.");
    return;
  }

  const page = parsePage(req.query.page);
  const built = await buildCityTeamPayload(city.id, { page });
  ok(
    res,
    {
      city: {
        id: city.id,
        slug: city.slug,
        name: city.name,
        state_name: city.state_name,
      },
      categories: built.categories,
    },
    {
      page: built.page,
      page_size: built.page_size,
      total_pages: built.total_pages,
      total_centres: built.total_centres,
      next_cursor: built.shikshak_next_cursor,
      // Hourly ISR stand-in for the Vite SPA (Next: revalidate = 3600).
      revalidate: 3600,
    },
  );
});

/* GET /v1/team/cities/:citySlug/shikshaks?cursor= | ?page=N — next centre batch only */
router.get("/cities/:citySlug/shikshaks", async (req: Request, res: Response) => {
  if (await teamRateLimited(req, res)) return;
  const slug = String(req.params.citySlug ?? "").trim().toLowerCase();
  if (!slug) {
    fail(res, 404, "ERR_NOT_FOUND", "City not found.");
    return;
  }

  const city = await resolveCityBySlug(slug);
  if (!city || !(await cityHasPublishedMembers(city.id))) {
    fail(res, 404, "ERR_NOT_FOUND", "City not found, or it has no published Team members yet.");
    return;
  }

  const hasCursor = Boolean(req.query.cursor);
  const cursor = decodeCentreCursor(req.query.cursor);
  if (hasCursor && !cursor) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "That cursor is invalid — refresh the Team page and try again.");
    return;
  }

  const pageNum = parsePage(req.query.page);
  const batch = await loadShikshakCentrePage({
    cityId: city.id,
    cursor: cursor ?? null,
    offset: hasCursor ? 0 : (pageNum - 1) * SHIKSHAK_CENTRES_PAGE_SIZE,
    limit: SHIKSHAK_CENTRES_PAGE_SIZE,
  });

  const total_pages = Math.max(1, Math.ceil(batch.total_centres / SHIKSHAK_CENTRES_PAGE_SIZE) || 1);
  const page = hasCursor
    ? Math.min(pageNum, total_pages)
    : Math.min(pageNum, total_pages);

  ok(
    res,
    { centres: batch.centres, member_count: batch.member_count },
    {
      page,
      page_size: SHIKSHAK_CENTRES_PAGE_SIZE,
      total_pages,
      total_centres: batch.total_centres,
      next_cursor: batch.next_cursor,
      count: batch.centres.length,
    },
  );
});

/* GET /v1/team/centres/:centreId — Centre Locator detail reuse */
router.get("/centres/:centreId", async (req: Request, res: Response) => {
  if (await teamRateLimited(req, res)) return;
  const centreId = String(req.params.centreId ?? "");
  if (!UUID_RE.test(centreId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found.");
    return;
  }

  const data = await buildCentreTeamPayload(centreId);
  if (!data) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found.");
    return;
  }
  ok(res, data);
});

export default router;
