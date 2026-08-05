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

export class ImageNormaliseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageNormaliseError";
  }
}

const ROTATABLE = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEIC = new Set(["image/heic", "image/heif"]);

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
        "Could not process this HEIC/HEIF photo. Please retry with a JPEG (iOS: use Compatible photo mode).",
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
        "Could not process this HEIC/HEIF photo. Please retry with a JPEG (iOS: use Compatible photo mode).",
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
