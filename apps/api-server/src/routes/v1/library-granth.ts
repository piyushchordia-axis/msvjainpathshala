/**
 * /v1/library/granth — v3 §17.11 read surface.
 *
 * Mounted ahead of /v1/library (requireAuth) with optionalAuth, because the
 * Library is browsable before sign-in and the Granth directory is the most
 * public thing in it — a visitor looking for where to borrow a granth has no
 * reason to have an account.
 *
 * Visibility is resolved through buildLibrarySection with the caller's own
 * guest flag, so a login-gated section's items never leak through this path
 * even as bare ids.
 */
import { Router, type IRouter, type Request, type Response } from "express";

import { ok, fail } from "../../lib/envelope";
import { optionalAuth } from "../../middlewares/auth";
import { UUID_RE } from "../../lib/validation";
import { buildLibrarySection } from "../../lib/library-tree";
import { granthAvailabilityForItems } from "../../lib/granth-availability";
import { buildGranthDirectory } from "../../lib/granth-directory";
import { db, library_sections } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

const router: IRouter = Router();
router.use(optionalAuth);

/**
 * GET /v1/library/granth/availability?section_id=…
 *
 * One request per section open, not one per card: a granth section can hold a
 * hundred entries and this screen has to work on a centre's wifi.
 */
router.get("/availability", async (req: Request, res: Response) => {
  const sectionId = String(req.query["section_id"] ?? "");
  if (!UUID_RE.test(sectionId)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Pass a section_id to look up availability for.");
    return;
  }

  const guestOnly = !req.authUser;
  const section = await buildLibrarySection(sectionId, { guestOnly });
  if (!section) {
    fail(res, 404, "ERR_NOT_FOUND", "That library section could not be found.");
    return;
  }

  const itemIds = [
    ...(section.items ?? []).map((i) => i.id),
    ...(section.subsections ?? []).flatMap((s) => (s.items ?? []).map((i) => i.id)),
  ];

  const items = await granthAvailabilityForItems(itemIds);
  ok(res, { items });
});

/**
 * GET /v1/library/granth/directory?section_id=…
 *
 * §17.11.4 — the whole directory in one response so it can be cached beside
 * the section tree and browsed with no network at all. Open to guests: the
 * gate is the parent section's, because the directory has no tier of its own
 * and a granth section published as public is public.
 */
router.get("/directory", async (req: Request, res: Response) => {
  const sectionId = String(req.query["section_id"] ?? "");
  if (!UUID_RE.test(sectionId)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Pass the granth section_id to load the directory for.");
    return;
  }

  const [section] = await db
    .select({
      id: library_sections.id,
      type: library_sections.type,
      requires_login: library_sections.requires_login,
    })
    .from(library_sections)
    .where(
      and(
        eq(library_sections.id, sectionId),
        isNull(library_sections.deleted_at),
        eq(library_sections.is_published, true),
      ),
    )
    .limit(1);

  if (!section || section.type !== "granth") {
    fail(res, 404, "ERR_NOT_FOUND", "That granth section could not be found.");
    return;
  }

  // A 403 rather than an empty directory: "no libraries listed" would read
  // as an empty shelf when the real answer is "sign in to see this one".
  if (section.requires_login && !req.authUser) {
    fail(res, 403, "ERR_FORBIDDEN", "Sign in to open this section — the granth directory is inside it.");
    return;
  }

  const directory = await buildGranthDirectory();
  ok(res, directory, {
    libraries: directory.libraries.length,
    entries: directory.entries.length,
  });
});

export default router;
