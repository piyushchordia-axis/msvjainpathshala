/**
 * /v1/uploads — shared authenticated file upload endpoint.
 * Any authed user may upload (proof photos, homework files, etc.); modules
 * store the returned `url`. Static serving is wired in app.ts at /uploads.
 *
 * Multipart files land on disk (os.tmpdir), not in heap. The magic-byte check
 * reads only the first 4 KB; images are normalised via sharp from the temp
 * path; everything else is streamed/copied into StorageProvider. The temp
 * file is unlinked in `finally` on every path.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { open, unlink } from "node:fs/promises";
import { z } from "zod";
import { db, upload_objects } from "@workspace/db";
import { ok, fail } from "../../lib/envelope";
import { requireAuth } from "../../middlewares/auth";
import { canAccessAdminPanel } from "@workspace/api-zod";
import {
  uploadMultipart,
  ALLOWED_MIME_TYPES,
  normalizeUploadMime,
  storageExtForUpload,
} from "../../lib/upload";
import { storage, makeKey } from "../../lib/storage";
import { fileTypeFromBuffer } from "file-type";
import { stripImageMetadataToFile, ImageNormaliseError } from "../../lib/image-normalise";

const router: IRouter = Router();
router.use(requireAuth);

const MAGIC_SAMPLE_BYTES = 4096;

// Folders that hold admin-published content — students/parents must not be able
// to plant files under these paths. (niyam-proof/homework/registration/
// student-photos/user-photos/misc stay open to any authenticated user.)
const ADMIN_FOLDERS = new Set(["gallery", "library", "id-cards", "competitions", "shivirs"]);

const folderSchema = z.enum([
  "niyam-proof",
  "homework",
  "gallery",
  "library",
  "id-cards",
  "registration",
  "student-photos",
  "user-photos",
  "competitions",
  "shivirs",
  "misc",
]);

async function readMagicSample(filePath: string): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(MAGIC_SAMPLE_BYTES);
    const { bytesRead } = await handle.read(buf, 0, MAGIC_SAMPLE_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function safeUnlink(filePath: string | undefined): Promise<void> {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch {
    /* already gone */
  }
}

/* POST /v1/uploads — multipart form-data, field "file", optional "folder" */
router.post("/", uploadMultipart.single("file"), async (req: Request, res: Response) => {
  const tempPath = req.file?.path;
  try {
    const file = req.file;
    if (!file || !tempPath) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "No file provided or file type not allowed.");
      return;
    }
    const declared = normalizeUploadMime(file.mimetype);
    if (!declared || !ALLOWED_MIME_TYPES.has(declared)) {
      fail(res, 422, "ERR_VALIDATION_FAILED", `File type not allowed (${file.mimetype || "unknown"}).`);
      return;
    }
    const folderParse = folderSchema.safeParse(req.body?.folder ?? "misc");
    if (!folderParse.success) {
      // Never silently downgrade to misc — that hid the homework-proof folder bug.
      fail(
        res,
        422,
        "ERR_VALIDATION_FAILED",
        `Unknown upload folder "${String(req.body?.folder)}".`,
      );
      return;
    }
    const folder = folderParse.data;
    if (ADMIN_FOLDERS.has(folder) && !canAccessAdminPanel(req.authUser!.role)) {
      fail(res, 403, "ERR_FORBIDDEN", "You may not upload to this folder.");
      return;
    }

    // Validate magic from the first ~4 KB only — never load the whole file.
    const head = await readMagicSample(tempPath);
    const detected = head.length > 0 ? await fileTypeFromBuffer(head) : undefined;
    const detectedMime = normalizeUploadMime(detected?.mime ?? null);
    // Some short AAC/M4A recordings are detected as audio/mp4; HEIC may be reported
    // as image/heic. Accept either detected or declared when both are allowlisted
    // and the buffer is non-empty (declared alone is never enough for unknown magic).
    //
    // Shared-container collisions — prefer the client's declared *audio* MIME:
    //   • audio/webm vs video/webm (same EBML) — file-type always reports video/webm
    //   • audio/mp4 vs video/mp4 (ISO BMFF) — Android MediaRecorder mpeg4/AAC often
    //     uses ftyp mp42/isom, which file-type reports as video/mp4. Storing that as
    //     video breaks niyam proof_type=audio (kind derived from content_type).
    const contentMime =
      ((declared === "audio/webm" && detectedMime === "video/webm") ||
        (declared === "audio/mp4" && detectedMime === "video/mp4"))
        ? declared
        : detectedMime && ALLOWED_MIME_TYPES.has(detectedMime)
          ? detectedMime
          : detected == null && file.size > 0 && ALLOWED_MIME_TYPES.has(declared)
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

    // Strip EXIF/GPS from images before disk/S3. Stream to a sibling temp file
    // so the normalised bytes never sit in heap (PERF #18). Videos are NOT
    // stripped here — TODO(ffmpeg-video-exif).
    let storeBody: Buffer | string = tempPath;
    let storeMime = contentMime;
    if (contentMime.startsWith("image/")) {
      try {
        const normalised = await stripImageMetadataToFile(
          tempPath,
          contentMime,
          `${tempPath}.norm`,
        );
        storeBody = normalised.path;
        storeMime = normalised.mime;
      } catch (err) {
        const message =
          err instanceof ImageNormaliseError
            ? err.message
            : "Could not process this image. Please try another photo.";
        fail(res, 422, "ERR_VALIDATION_FAILED", message);
        return;
      }
    }

    // Prefer file-type's ext only when it matches our table for storeMime;
    // HEIC→JPEG must land as .jpg (use post-normalise MIME).
    const ext = storageExtForUpload(storeMime, storeMime === contentMime ? detected?.ext : undefined);
    const key = makeKey(folder, `upload.${ext}`);
    const stored = await storage.put(key, storeBody, storeMime);
    await db
      .insert(upload_objects)
      .values({ key, uploaded_by: req.authUser!.id, content_type: storeMime })
      .onConflictDoNothing();
    ok(res, stored);
  } finally {
    await safeUnlink(tempPath);
    // normalised sibling may exist even when put failed mid-flight
    await safeUnlink(`${tempPath}.norm`);
  }
});

export default router;
