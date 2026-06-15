/**
 * /v1/uploads — shared authenticated file upload endpoint.
 * Any authed user may upload (proof photos, homework files, etc.); modules
 * store the returned `url`. Static serving is wired in app.ts at /uploads.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth } from "../../middlewares/auth";
import { canAccessAdminPanel } from "@workspace/api-zod";
import { uploadMemory, ALLOWED_MIME_TYPES } from "../../lib/upload";
import { storage, makeKey } from "../../lib/storage";

const router: IRouter = Router();
router.use(requireAuth);

// Folders that hold admin-published content — students/parents must not be able
// to plant files under these paths. (niyam-proof/homework/registration/misc
// stay open to any authenticated user for their own submissions.)
const ADMIN_FOLDERS = new Set(["gallery", "library", "id-cards", "competitions", "shivirs"]);

const folderSchema = z.enum([
  "niyam-proof",
  "homework",
  "gallery",
  "library",
  "id-cards",
  "registration",
  "competitions",
  "shivirs",
  "misc",
]);

/* POST /v1/uploads — multipart form-data, field "file", optional "folder" */
router.post("/", uploadMemory.single("file"), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "No file provided or file type not allowed.");
    return;
  }
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "File type not allowed.");
    return;
  }
  const folderParse = folderSchema.safeParse(req.body?.folder ?? "misc");
  const folder = folderParse.success ? folderParse.data : "misc";
  if (ADMIN_FOLDERS.has(folder) && !canAccessAdminPanel(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "You may not upload to this folder.");
    return;
  }

  const key = makeKey(folder, file.originalname);
  const stored = await storage.put(key, file.buffer, file.mimetype);
  ok(res, stored);
});

export default router;
