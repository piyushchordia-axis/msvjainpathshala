/**
 * Multipart upload handling (disk-backed temp) shared by all modules.
 * Files land in os.tmpdir(), then stream into StorageProvider; temps are
 * always unlinked by the upload route.
 *
 * Single source of truth for MIME ↔ extension. Upload allowlist, storage
 * extension, and /uploads Content-Type all derive from UPLOAD_MIME_TABLE so
 * they cannot drift.
 */
import multer from "multer";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_UPLOAD_BYTES } from "@workspace/api-zod";

/** Max upload size: 50 MB (30s 1080p proofs + headroom for high-bitrate devices). */
export { MAX_UPLOAD_BYTES };

/** Prefix for multer temp files — tests assert none remain after the request. */
export const UPLOAD_TEMP_PREFIX = "jp-upload-";

type MimeEntry = {
  /** Canonical file extension used when storing (no leading dot). */
  ext: string;
  /** Client/browser aliases that normalize to this canonical MIME. */
  aliases?: readonly string[];
};

/**
 * Canonical MIME → extension (+ aliases). Every allowlisted type lives here.
 * audio/webm uses `.weba` so MIME_BY_EXT stays unambiguous vs video/webm `.webm`.
 */
export const UPLOAD_MIME_TABLE = {
  "image/jpeg": { ext: "jpg", aliases: ["image/jpg"] },
  "image/png": { ext: "png" },
  "image/webp": { ext: "webp" },
  "image/gif": { ext: "gif" },
  "image/heic": { ext: "heic" },
  "image/heif": { ext: "heif" },
  "application/pdf": { ext: "pdf" },
  "video/mp4": { ext: "mp4" },
  "video/quicktime": { ext: "mov" },
  "video/webm": { ext: "webm" },
  "audio/mpeg": { ext: "mp3" },
  "audio/mp4": {
    ext: "m4a",
    aliases: ["audio/m4a", "audio/x-m4a", "audio/aac", "audio/mp4a-latm"],
  },
  "audio/wav": { ext: "wav", aliases: ["audio/x-wav"] },
  "audio/webm": { ext: "weba" },
  "audio/ogg": { ext: "ogg" },
} as const satisfies Record<string, MimeEntry>;

export type CanonicalUploadMime = keyof typeof UPLOAD_MIME_TABLE;

/** Allowlist of accepted canonical MIME types. Anything else is rejected. */
export const ALLOWED_MIME_TYPES: Set<string> = new Set(Object.keys(UPLOAD_MIME_TABLE));

/** Canonical extension (no dot) for a resolved content MIME. */
export const EXT_BY_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(UPLOAD_MIME_TABLE).map(([mime, { ext }]) => [mime, ext]),
);

/**
 * Extension (no leading dot) → Content-Type for /uploads serving.
 * Built from the same table so every stored ext is servable as its MIME.
 */
export const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(UPLOAD_MIME_TABLE).map(([mime, { ext }]) => [ext, mime]),
);

/** Alias / declared MIME → canonical allowlisted MIME. */
const ALIAS_TO_CANONICAL: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [mime, entry] of Object.entries(UPLOAD_MIME_TABLE) as Array<
    [string, MimeEntry]
  >) {
    map[mime] = mime;
    for (const alias of entry.aliases ?? []) {
      map[alias] = mime;
    }
  }
  return map;
})();

/** Normalize client/browser aliases to a canonical allowlisted type. */
export function normalizeUploadMime(mime: string | undefined | null): string | null {
  if (!mime) return null;
  const base = mime.split(";")[0]!.trim().toLowerCase();
  return ALIAS_TO_CANONICAL[base] ?? base;
}

/**
 * Prefer file-type's extension only when it matches our table for contentMime;
 * otherwise use EXT_BY_MIME so serving never sees an unknown suffix.
 */
export function storageExtForUpload(
  contentMime: string,
  detectedExt: string | undefined,
): string {
  const tableExt = EXT_BY_MIME[contentMime];
  if (!tableExt) {
    throw new Error(`No storage extension for MIME ${contentMime}`);
  }
  if (detectedExt && detectedExt === tableExt) return detectedExt;
  // file-type may return a synonym (e.g. "jpeg" vs "jpg") — accept only exact table match.
  return tableExt;
}

/**
 * Multipart middleware: disk-backed temp under os.tmpdir() (not memory).
 * Callers must unlink `req.file.path` in a finally block on every exit path.
 */
export const uploadMultipart = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, os.tmpdir());
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 16);
      cb(null, `${UPLOAD_TEMP_PREFIX}${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mime = normalizeUploadMime(file.mimetype);
    if (mime && ALLOWED_MIME_TYPES.has(mime)) {
      file.mimetype = mime;
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});

/** @deprecated Alias — same disk-backed middleware (name kept for older imports). */
export const uploadMemory = uploadMultipart;
