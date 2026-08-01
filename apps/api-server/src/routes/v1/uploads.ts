/**
 * /v1/uploads — shared authenticated file upload endpoint.
 * Any authed user may upload (proof photos, homework files, etc.); modules
 * store the returned `url`. Static serving is wired in app.ts at /uploads.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, upload_objects } from "@workspace/db";
import { ok, fail } from "../../lib/envelope";
import { requireAuth } from "../../middlewares/auth";
import { canAccessAdminPanel } from "@workspace/api-zod";
import { uploadMemory, ALLOWED_MIME_TYPES, normalizeUploadMime } from "../../lib/upload";
import { storage, makeKey } from "../../lib/storage";
import { fileTypeFromBuffer } from "file-type";

const router: IRouter = Router();
router.use(requireAuth);

// Folders that hold admin-published content — students/parents must not be able
// to plant files under these paths. (niyam-proof/homework/registration/
// student-photos/misc stay open to any authenticated user for their own files.)
const ADMIN_FOLDERS = new Set(["gallery", "library", "id-cards", "competitions", "shivirs"]);

const folderSchema = z.enum([
  "niyam-proof",
  "homework",
  "gallery",
  "library",
  "id-cards",
  "registration",
  "student-photos",
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
  const declared = normalizeUploadMime(file.mimetype);
  if (!declared || !ALLOWED_MIME_TYPES.has(declared)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", `File type not allowed (${file.mimetype || "unknown"}).`);
    return;
  }
  const folderParse = folderSchema.safeParse(req.body?.folder ?? "misc");
  const folder = folderParse.success ? folderParse.data : "misc";
  if (ADMIN_FOLDERS.has(folder) && !canAccessAdminPanel(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "You may not upload to this folder.");
    return;
  }

  // Validate the ACTUAL bytes (magic number), not the client-declared mimetype,
  // so a script file mislabeled as image/png can't be stored. Derive the stored
  // extension from the detected type too (ignore the client filename).
  const detected = await fileTypeFromBuffer(file.buffer);
  const detectedMime = normalizeUploadMime(detected?.mime ?? null);
  // Some short AAC/M4A recordings are detected as audio/mp4; HEIC may be reported
  // as image/heic. Accept either detected or declared when both are allowlisted
  // and the buffer is non-empty (declared alone is never enough for unknown magic).
  const contentMime =
    detectedMime && ALLOWED_MIME_TYPES.has(detectedMime)
      ? detectedMime
      : detected == null && file.buffer.length > 0 && ALLOWED_MIME_TYPES.has(declared)
        ? // file-type returns undefined for a few valid formats (e.g. some wav/caf);
          // fall back to the normalized client mime only when magic is unknown.
          declared
        : null;
  if (!contentMime) {
    fail(
      res,
      422,
      "ERR_VALIDATION_FAILED",
      `File content does not match an allowed type${detected?.mime ? ` (detected ${detected.mime})` : ""}.`,
    );
    return;
  }

  const ext =
    detected?.ext ??
    (contentMime.startsWith("audio/")
      ? "m4a"
      : contentMime.startsWith("video/")
        ? "mp4"
        : contentMime === "image/png"
          ? "png"
          : "jpg");
  const key = makeKey(folder, `upload.${ext}`);
  const stored = await storage.put(key, file.buffer, contentMime);
  await db
    .insert(upload_objects)
    .values({ key, uploaded_by: req.authUser!.id })
    .onConflictDoNothing();
  ok(res, stored);
});

export default router;
