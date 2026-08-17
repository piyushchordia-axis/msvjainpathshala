/**
 * /v1/library — published tree for members.
 * Authoring lives under /v1/admin/library.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { ok, fail } from "../../lib/envelope";
import { requireAuth } from "../../middlewares/auth";
import { buildLibraryTree, buildLibrarySection, buildLibraryItem } from "../../lib/library-tree";
import { buildLibraryManifest } from "../../lib/library-manifest";

const router: IRouter = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /v1/library — member tree (includes requires_login sections). */
router.get("/", async (_req: Request, res: Response) => {
  const sections = await buildLibraryTree({ guestOnly: false });
  ok(res, { sections }, { count: sections.length });
});

/* Writes are deliberately not served here — authoring lives under
   /v1/admin/library. An explicit 501 beats a 404 that reads as a typo'd URL. */
router.all("/", (_req: Request, res: Response) => {
  fail(res, 501, "ERR_INTERNAL", "The library is read-only here — authoring lives in the admin panel.");
});

/** GET /v1/library/manifest — section/item content_version maps. */
router.get("/manifest", async (_req: Request, res: Response) => {
  const manifest = await buildLibraryManifest({ guestOnly: false });
  ok(res, manifest);
});

/** GET /v1/library/sections/:id — one published section tree node. */
router.get("/sections/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "That library section could not be found.");
    return;
  }
  const section = await buildLibrarySection(id, { guestOnly: false });
  if (!section) {
    fail(res, 404, "ERR_NOT_FOUND", "That library section could not be found.");
    return;
  }
  ok(res, { section });
});

/** GET /v1/library/items/:id — one published item (deep-link unit, GST-PRF-01). */
router.get("/items/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "That text could not be found.");
    return;
  }
  const item = await buildLibraryItem(id, { guestOnly: false });
  if (!item) {
    fail(res, 404, "ERR_NOT_FOUND", "That text could not be found.");
    return;
  }
  ok(res, { item });
});

export default router;
