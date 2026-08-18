/**
 * /v1/panchang — the public read surface for published Panchang years.
 *
 * This did not exist. Admins could upload a year, an admin could publish it, and
 * the payload sat in panchang_years.published_payload where no client could ever
 * read it: the mobile fetch was a stub returning null, so the app lived on its
 * bundled file forever and a corrected year could never reach a single device.
 *
 * optionalAuth, matching library-granth and library-access rather than
 * /v1/library's blanket requireAuth. The Panchang is reachable before sign-in on
 * mobile, and a family checking when Samvatsari falls has no reason to have an
 * account. Behind requireAuth a guest could never receive a correction, which is
 * the failure this route exists to end.
 *
 * Only published_payload is ever served. The draft is the admin's working copy
 * and is unverified by definition.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { asc, and, eq, isNull } from "drizzle-orm";
import { db, panchang_years } from "@workspace/db";

import { ok, fail } from "../../lib/envelope";
import { optionalAuth } from "../../middlewares/auth";

const router: IRouter = Router();
router.use(optionalAuth);

/**
 * GET /v1/panchang/years
 *
 * The manifest the client polls: which years exist and what version each is at.
 * Without it a device cannot tell that 2027 has been published, and the whole
 * delivery path only ever works for a year the app already knows to ask for.
 */
router.get("/years", async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      year: panchang_years.year,
      sect: panchang_years.sect,
      content_version: panchang_years.content_version,
    })
    .from(panchang_years)
    .where(and(eq(panchang_years.is_published, true), isNull(panchang_years.deleted_at)))
    .orderBy(asc(panchang_years.year));
  ok(res, { items: rows }, { count: rows.length });
});

/**
 * GET /v1/panchang/years/:year
 *
 * 404 for an unpublished year, deliberately not the draft. An unpublished year
 * is one nobody has verified yet, and this module's entire failure was showing
 * unverified tithis as though they were transcribed.
 */
router.get("/years/:year", async (req: Request, res: Response) => {
  const year = Number(req.params.year);
  if (!Number.isInteger(year)) {
    fail(res, 404, "ERR_NOT_FOUND", "That Panchang year could not be found.");
    return;
  }
  const [row] = await db
    .select({
      year: panchang_years.year,
      content_version: panchang_years.content_version,
      published_payload: panchang_years.published_payload,
    })
    .from(panchang_years)
    .where(
      and(
        eq(panchang_years.year, year),
        eq(panchang_years.is_published, true),
        isNull(panchang_years.deleted_at),
      ),
    )
    .limit(1);

  if (!row?.published_payload) {
    fail(
      res,
      404,
      "ERR_NOT_FOUND",
      "No published Panchang for that year yet — check back once it has been verified.",
    );
    return;
  }

  ok(res, {
    year: row.year,
    content_version: row.content_version,
    payload: row.published_payload,
  });
});

export default router;
