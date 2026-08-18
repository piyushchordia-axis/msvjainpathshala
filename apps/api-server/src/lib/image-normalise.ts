/**
 * Strip image metadata (EXIF/GPS/IPTC) before storing uploads.
 *
 * Camera JPEGs from iOS/Android embed GPS in EXIF. Niyam proofs can flow into
 * the public gallery — storing the raw buffer would publish children's home
 * locations. sharp.rotate() with no args applies the Orientation tag and drops
 * all metadata; do NOT call .withMetadata().
 *
 * Videos are a KNOWN REMAINING GAP — QuickTime carries
 * com.apple.quicktime.location.ISO6709 and stripping it needs ffmpeg, which is
 * not a dependency yet. Gallery publishing must never accept video; see
 * maybeInsertGalleryFromSubmission + TODO(ffmpeg-video-exif).
 */
import { copyFile, readFile } from "node:fs/promises";
import sharp from "sharp";
import { ERROR_MESSAGES, ErrorCode } from "@workspace/api-zod";
import { logger } from "./logger";

export class ImageNormaliseError extends Error {
  /**
   * Carried so routes can answer with the right code rather than flattening
   * every image problem into ERR_VALIDATION_FAILED — which screens override
   * with "choose a clear image", advice that is simply wrong for a format the
   * server cannot decode.
   */
  readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode = "ERR_VALIDATION_FAILED") {
    super(message);
    this.name = "ImageNormaliseError";
    this.code = code;
  }
}

const ROTATABLE = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEIC = new Set(["image/heic", "image/heif"]);

/**
 * Whether this sharp build can actually decode an iPhone HEIC.
 *
 * libvips advertises a `heif` loader whenever libheif is linked, but the
 * prebuilt sharp binaries link it with AV1 only — no libde265, no x265 — so
 * `format.heif.input.fileSuffix` reads [".avif"] and every HEVC-coded HEIC (i.e.
 * every photo an iPhone takes) fails to decode. The suffix list is the one
 * capability signal libvips exposes for this.
 *
 * Log-only. The conversion below is still attempted, so a deployment that does
 * carry the codec simply works without a code change.
 */
export function heicDecodeLikelySupported(): boolean {
  const suffixes = sharp.format.heif?.input?.fileSuffix ?? [];
  return suffixes.some((s) => s === ".heic" || s === ".heif");
}

/**
 * Called at boot (see index.ts) so the warning lands in the startup logs
 * rather than in whichever request first happens to carry a HEIC — i.e.
 * exactly when nobody is reading. Returns whether the codec is present so
 * callers can assert on it.
 */
export function warnIfHeicUndecodable(): boolean {
  const supported = heicDecodeLikelySupported();
  if (!supported) {
    logger.warn(
      { heifInputSuffixes: sharp.format.heif?.input?.fileSuffix ?? [] },
      "sharp has no HEIC/HEVC decoder (libheif is AV1-only in the prebuilt binary), so " +
        "HEIC uploads are refused with ERR_UPLOAD_FORMAT_UNSUPPORTED. Clients must send " +
        "JPEG — check preferredAssetRepresentationMode on the mobile pickers.",
    );
  }
  return supported;
}

/**
 * Normalise an allowlisted image to an output path (PERF #18): apply EXIF
 * orientation, drop metadata, never hold the whole result in heap.
 * HEIC/HEIF → JPEG when libheif is available.
 * Fail closed — never copy the original for image/* types (except GIF).
 *
 * mozjpeg is intentionally OFF on the request path (3–5× slower); worker
 * pipelines that need it can call sharp directly.
 */
export async function stripImageMetadataToFile(
  inputPath: string,
  mime: string,
  outputPath: string,
): Promise<{ path: string; mime: string }> {
  const base = mime.split(";")[0]!.trim().toLowerCase();

  if (base === "image/gif") {
    await copyFile(inputPath, outputPath);
    return { path: outputPath, mime: base };
  }

  if (HEIC.has(base)) {
    try {
      await sharp(inputPath).rotate().jpeg({ quality: 88 }).toFile(outputPath);
      return { path: outputPath, mime: "image/jpeg" };
    } catch {
      throw new ImageNormaliseError(
        ERROR_MESSAGES.ERR_UPLOAD_FORMAT_UNSUPPORTED.en,
        "ERR_UPLOAD_FORMAT_UNSUPPORTED",
      );
    }
  }

  if (ROTATABLE.has(base)) {
    try {
      const pipeline = sharp(inputPath).rotate();
      if (base === "image/png") {
        await pipeline.png().toFile(outputPath);
      } else if (base === "image/webp") {
        await pipeline.webp().toFile(outputPath);
      } else {
        await pipeline.jpeg({ quality: 90 }).toFile(outputPath);
      }
      return { path: outputPath, mime: base };
    } catch {
      throw new ImageNormaliseError(
        "Could not process this image. The file may be corrupt — please try another photo.",
      );
    }
  }

  if (base.startsWith("image/")) {
    throw new ImageNormaliseError(
      "Could not process this image. Please try another photo.",
    );
  }

  await copyFile(inputPath, outputPath);
  return { path: outputPath, mime: base };
}

/**
 * Buffer-based variant kept for callers that already hold bytes (tests, small
 * assets). Prefer stripImageMetadataToFile on the upload request path.
 */
export async function stripImageMetadata(
  input: Buffer | string,
  mime: string,
): Promise<{ buffer: Buffer; mime: string }> {
  const base = mime.split(";")[0]!.trim().toLowerCase();

  if (base === "image/gif") {
    const buffer = typeof input === "string" ? await readFile(input) : input;
    return { buffer, mime: base };
  }

  if (HEIC.has(base)) {
    try {
      const buffer = await sharp(input).rotate().jpeg({ quality: 88 }).toBuffer();
      return { buffer, mime: "image/jpeg" };
    } catch {
      throw new ImageNormaliseError(
        ERROR_MESSAGES.ERR_UPLOAD_FORMAT_UNSUPPORTED.en,
        "ERR_UPLOAD_FORMAT_UNSUPPORTED",
      );
    }
  }

  if (ROTATABLE.has(base)) {
    try {
      const pipeline = sharp(input).rotate();
      const buffer =
        base === "image/png"
          ? await pipeline.png().toBuffer()
          : base === "image/webp"
            ? await pipeline.webp().toBuffer()
            : await pipeline.jpeg({ quality: 90 }).toBuffer();
      return { buffer, mime: base };
    } catch {
      throw new ImageNormaliseError(
        "Could not process this image. The file may be corrupt — please try another photo.",
      );
    }
  }

  if (base.startsWith("image/")) {
    throw new ImageNormaliseError(
      "Could not process this image. Please try another photo.",
    );
  }

  const buffer = typeof input === "string" ? await readFile(input) : input;
  return { buffer, mime: base };
}
