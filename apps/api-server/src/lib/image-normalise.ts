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
import { readFile } from "node:fs/promises";
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
 * Normalise an allowlisted image (buffer or temp path): apply EXIF orientation,
 * drop all metadata. HEIC/HEIF are converted to JPEG when libheif is available.
 * Fail closed — never return the original bytes for image/* types (except GIF).
 */
export async function stripImageMetadata(
  input: Buffer | string,
  mime: string,
): Promise<{ buffer: Buffer; mime: string }> {
  const base = mime.split(";")[0]!.trim().toLowerCase();

  // Animated GIFs: sharp would flatten frames — leave bytes alone.
  // GIF has no EXIF GPS in practice; privacy risk is on JPEG/HEIC.
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
      // .rotate() with no argument: honour Orientation, then strip all metadata.
      const pipeline = sharp(input).rotate();
      const buffer =
        base === "image/png"
          ? await pipeline.png().toBuffer()
          : base === "image/webp"
            ? await pipeline.webp().toBuffer()
            : await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      return { buffer, mime: base };
    } catch {
      throw new ImageNormaliseError(
        "Could not process this image. The file may be corrupt — please try another photo.",
      );
    }
  }

  // Unknown image/* — fail closed rather than store unstripped bytes.
  if (base.startsWith("image/")) {
    throw new ImageNormaliseError(
      "Could not process this image. Please try another photo.",
    );
  }

  const buffer = typeof input === "string" ? await readFile(input) : input;
  return { buffer, mime: base };
}
