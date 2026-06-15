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
  "application/pdf",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
]);

/** A configured multer instance: single in-memory file, size-limited, MIME-filtered. */
export const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});
