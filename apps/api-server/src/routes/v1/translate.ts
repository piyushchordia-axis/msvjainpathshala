/**
 * POST /v1/translate — reviewed Hindi suggestion for notice composition.
 * GET  /v1/translate — whether a provider is configured (UI hides the button when not).
 *
 * Costs money per call: requireAuth + admin-panel (shikshak+) and a Redis/memory
 * sliding window of 20/hour/user via the shared rateLimit helper.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { ERROR_MESSAGES } from "@workspace/api-zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { rateLimit } from "../../lib/ratelimit";
import {
  isTranslationAvailable,
  translateToHindi,
  TranslationFailedError,
  TranslationUnavailableError,
} from "../../services/translate";

const router: IRouter = Router();

const bodySchema = z.object({
  text: z.string().min(1).max(8000),
  target: z.literal("hi"),
  context: z.literal("notice"),
});

/* GET /v1/translate — capability probe for the compose UI */
router.get("/", requireAuth, requireAdminPanel, (_req: Request, res: Response) => {
  ok(res, { available: isTranslationAvailable() });
});

/* POST /v1/translate */
router.post("/", requireAuth, requireAdminPanel, async (req: Request, res: Response) => {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid translation request.");
    return;
  }

  const uid = req.authUser!.id;
  if (await rateLimit(`translate:hour:${uid}`, 20, 3600)) {
    fail(
      res,
      429,
      "ERR_RATE_LIMITED",
      ERROR_MESSAGES.ERR_RATE_LIMITED.en,
    );
    return;
  }

  try {
    const text = await translateToHindi(body.text, { context: body.context });
    ok(res, { text });
  } catch (err) {
    if (err instanceof TranslationUnavailableError) {
      fail(res, 503, err.code, err.message);
      return;
    }
    if (err instanceof TranslationFailedError) {
      fail(res, 502, err.code, err.message);
      return;
    }
    fail(
      res,
      502,
      "ERR_TRANSLATION_FAILED",
      ERROR_MESSAGES.ERR_TRANSLATION_FAILED.en,
    );
  }
});

export default router;
