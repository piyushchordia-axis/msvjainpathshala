/**
 * /v1/library — published tree for members.
 * Authoring lives under /v1/admin/library.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { ok, fail } from "../../lib/envelope";
import { requireAuth } from "../../middlewares/auth";
import { buildLibraryTree, buildLibrarySection } from "../../lib/library-tree";
import { buildLibraryManifest } from "../../lib/library-manifest";

const router: IRouter = Router();
router.use(requireAuth);

/** GET /v1/library — member tree (includes requires_login sections). */
router.get("/", async (_req: Request, res: Response) => {
  const sections = await buildLibraryTree({ guestOnly: false });
  ok(res, { sections }, { count: sections.length });
});

/** GET /v1/library/manifest — section/item content_version maps. */
router.get("/manifest", async (_req: Request, res: Response) => {
  const manifest = await buildLibraryManifest({ guestOnly: false });
  ok(res, manifest);
});

/** GET /v1/library/sections/:id — one published section tree node. */
router.get("/sections/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const section = await buildLibrarySection(id, { guestOnly: false });
  if (!section) {
    fail(res, 404, "ERR_NOT_FOUND", "That library section could not be found.");
    return;
  }
  ok(res, { section });
});

export default router;
