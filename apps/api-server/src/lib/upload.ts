/**
 * Multipart upload handling (in-memory) shared by all modules.
 * Files are buffered in memory then handed to the StorageProvider.
 */
import multer from "multer";

/** Max upload size: 25 MB (covers images, short proof videos, PDFs). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Allowlist of accepted MIME types. Anything else is rejected. */
export const ALLOWED_MIME_TYPES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
]);

/** Normalize client/browser aliases to a canonical allowlisted type. */
export function normalizeUploadMime(mime: string | undefined | null): string | null {
  if (!mime) return null;
  const base = mime.split(";")[0]!.trim().toLowerCase();
  const aliases: Record<string, string> = {
    "audio/m4a": "audio/mp4",
    "audio/x-m4a": "audio/mp4",
    "audio/aac": "audio/mp4",
    "audio/mp4a-latm": "audio/mp4",
    "image/jpg": "image/jpeg",
  };
  return aliases[base] ?? base;
}

/** A configured multer instance: single in-memory file, size-limited, MIME-filtered. */
export const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mime = normalizeUploadMime(file.mimetype);
    if (mime && ALLOWED_MIME_TYPES.has(mime)) {
      // Normalize so downstream sees a canonical type.
      file.mimetype = mime;
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});
