/**
 * POST /v1/library/access — v3 §17.9 access logging.
 *
 * Open to guests, like the rest of the Library: the shelf is browsable before
 * sign-in, so reach measured only after login would miss most of it. Guests are
 * identified by the same device id §17.9 uses pre-login; on first login those
 * rows are folded into the account.
 *
 * Mounted ahead of /v1/library (which is requireAuth) and flat rather than
 * nested under /items/:id, because a router mounted at /library/items would
 * shadow the member deep-link route.
 *
 * Fire-and-forget by design: this always answers 202 for a well-formed body,
 * whether or not a row was written. A reader tapping a PDF must never see an
 * error because analytics were unavailable.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { libraryAccessLogWriteSchema } from "@workspace/api-zod";

import { ok, fail } from "../../lib/envelope";
import { optionalAuth } from "../../middlewares/auth";
import { zodDetails } from "../../lib/panchang-schema";
import { deviceIdFromRequest } from "../../lib/library-requests";
import { recordLibraryAccess } from "../../lib/library-access-log";

const router: IRouter = Router();
router.use(optionalAuth);

router.post("/", async (req: Request, res: Response) => {
  const parsed = libraryAccessLogWriteSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid access log payload.", zodDetails(parsed.error));
    return;
  }
  const userId = req.authUser?.id ?? null;
  const deviceId = deviceIdFromRequest(req, parsed.data.device_id ?? null);
  if (!userId && !deviceId) {
    fail(
      res,
      422,
      "ERR_VALIDATION_FAILED",
      "Send a device_id, or sign in — an access record needs someone to belong to.",
    );
    return;
  }

  // The schema guarantees exactly one target; §17.9 granth_view is the
  // section case and everything else is content.
  const target = parsed.data.item_id
    ? { itemId: parsed.data.item_id }
    : { sectionId: parsed.data.section_id! };

  const recorded = await recordLibraryAccess(target, parsed.data.event, {
    userId,
    deviceId,
  });

  // 202, not 200: the client is told the report was taken, not that a row
  // exists. `recorded` is there for tests and diagnostics — no caller
  // should branch on it, and none does.
  ok(res, { recorded }, undefined, 202);
});

export default router;
