/**
 * POST /v1/sync/batch — sole offline transport (canonical model).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { ok, fail } from "../../lib/envelope";
import { requireAuth } from "../../middlewares/auth";
import { processSyncBatch, syncBatchBodySchema } from "../../services/sync-batch";

const router: IRouter = Router();
router.use(requireAuth);

router.post("/batch", async (req: Request, res: Response) => {
  let body;
  try {
    body = syncBatchBodySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid sync batch payload.");
    return;
  }

  const { results } = await processSyncBatch(req.authUser!, body);
  ok(res, { results });
});

export default router;
