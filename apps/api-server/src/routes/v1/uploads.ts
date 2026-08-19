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
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/auth";
import { canAccessAdminPanel } from "@workspace/api-zod";
import {
  uploadMultipart,
  ALLOWED_MIME_TYPES,
  normalizeUploadMime,
  storageExtForUpload,
} from "../../lib/upload";
import { storage, makeKey } from "../../lib/storage";
import { rateLimit } from "../../lib/ratelimit";
import { fileTypeFromBuffer } from "file-type";
import { stripImageMetadataToFile, ImageNormaliseError } from "../../lib/image-normalise";
import { assetIdFromTeamPhotoKey } from "../../lib/team-admin";
import { hasMinRole } from "../../lib/roles";
import type { Role } from "@workspace/api-zod";

const router: IRouter = Router();
router.use(requireAuth);

const MAGIC_SAMPLE_BYTES = 4096;

// Folders that hold admin-published content — students/parents must not be able
// to plant files under these paths. (niyam-proof/homework/registration/
// student-photos/user-photos/misc stay open to any authenticated user.)
const ADMIN_FOLDERS = new Set(["gallery", "library", "id-cards", "competitions", "shivirs", "team-photos"]);

/** Media purpose team_photo — 5 MB, images only (running stand-in for SPEC media finalize). */
const TEAM_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

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
  "team-photos",
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

/**
 * Delete a temp file, tolerating "already gone".
 *
 * Retries once on EBUSY/EPERM, then LOGS rather than discarding. It used to
 * swallow every error in an empty `catch {}`, which is how the leak below went
 * unnoticed for as long as it did.
 *
 * KNOWN RESIDUAL (Windows only): a WebP upload still leaves its multer temp
 * behind. libvips' WebP loader holds the input open past `sharp.destroy()` —
 * longer than any reasonable inline retry — and Windows refuses to unlink an
 * open file. Linux (the Docker runtime image) unlinks regardless, so deployed
 * environments are unaffected; this costs a dev machine one 68-byte file per
 * WebP upload. The only complete fix is to hand sharp a Buffer instead of a
 * path, and MAX_UPLOAD_BYTES is 50 MB — buffering that per request would undo
 * the deliberate "files land on disk, not in heap" design this module is built
 * around. Not worth the trade; the warning above makes it visible if it grows.
 */
async function safeUnlink(filePath: string | undefined): Promise<void> {
  if (!filePath) return;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await unlink(filePath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT") return; // already gone — the normal case
      if (attempt === 0 && (code === "EBUSY" || code === "EPERM")) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }
      logger.warn({ err, filePath }, "upload temp cleanup failed");
      return;
    }
  }
}

/* POST /v1/uploads — multipart form-data, field "file", optional "folder" */
router.post("/", uploadMultipart.single("file"), async (req: Request, res: Response) => {
  const tempPath = req.file?.path;
  try {
    // Authenticated multipart write straight to object storage — direct spend
    // with no cap. Keyed per USER, not per IP: a centre behind one NAT would
    // otherwise share a single budget. Inside the try so the `finally` below
    // still reclaims the spooled temp file on the 429 path.
    if (await rateLimit(`uploads:user:${req.authUser!.id}`, 60, 3600)) {
      fail(res, 429, "ERR_RATE_LIMITED", "Too many uploads just now — please try again in a little while.");
      return;
    }
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
    const purpose =
      typeof req.body?.purpose === "string" ? String(req.body.purpose).trim() : "";
    // purpose=team_photo is the SPEC media kind; map onto folder team-photos.
    const folderRaw =
      purpose === "team_photo" ? "team-photos" : (req.body?.folder ?? "misc");
    const folderParse = folderSchema.safeParse(folderRaw);
    if (!folderParse.success) {
      // Never silently downgrade to misc — that hid the homework-proof folder bug.
      fail(
        res,
        422,
        "ERR_VALIDATION_FAILED",
        `Unknown upload folder "${String(folderRaw)}".`,
      );
      return;
    }
    const folder = folderParse.data;
    if (ADMIN_FOLDERS.has(folder) && !canAccessAdminPanel(req.authUser!.role)) {
      fail(res, 403, "ERR_FORBIDDEN", "You may not upload to this folder.");
      return;
    }
    if (folder === "team-photos" && !hasMinRole(req.authUser!.role as Role, "city_admin")) {
      fail(res, 403, "ERR_TEAM_PUBLISH_FORBIDDEN", "You may not upload Team photos.");
      return;
    }
    if (folder === "team-photos" && file.size > TEAM_PHOTO_MAX_BYTES) {
      fail(
        res,
        400,
        "ERR_FILE_TOO_LARGE",
        "That Team photo is too large (max 5 MB). Use a smaller image and try again.",
      );
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
    if (folder === "team-photos" && !contentMime.startsWith("image/")) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Team photos must be images (JPEG, PNG, WebP, or GIF).");
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
        // Carry the specific code through: screens override ERR_VALIDATION_FAILED
        // with "choose a clear image", which is wrong advice for a format we
        // simply cannot decode.
        const message =
          err instanceof ImageNormaliseError
            ? err.message
            : "Could not process this image. Please try another photo.";
        const code =
          err instanceof ImageNormaliseError ? err.code : "ERR_VALIDATION_FAILED";
        fail(res, 422, code, message);
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
    const assetId = folder === "team-photos" ? assetIdFromTeamPhotoKey(key) : null;
    // Reclaim the temps BEFORE responding. This used to happen only in the
    // `finally`, i.e. after `ok()` had already flushed the 200 — so the files
    // were still being unlinked once the client held its response, and nothing
    // downstream could observe that cleanup had finished.
    await Promise.all([safeUnlink(tempPath), safeUnlink(`${tempPath}.norm`)]);
    ok(res, assetId ? { ...stored, asset_id: assetId, purpose: "team_photo" } : stored);
  } finally {
    // Net for the error and early-return paths (429, validation refusals, a
    // throw mid-upload). safeUnlink treats ENOENT as success, so repeating it
    // on the happy path is a no-op.
    await Promise.all([
      safeUnlink(tempPath),
      // normalised sibling may exist even when put failed mid-flight
      safeUnlink(`${tempPath}.norm`),
    ]);
  }
});

export default router;
