/**
 * Code 39 barcode helpers for student ID cards.
 * Encodes a unique enrolment / student code as a scannable 1D barcode.
 */
import bwipjs from "bwip-js";

/** Code 39 allows A–Z, 0–9, and -.$/+% space. Normalise student codes for encoding. */
export function toCode39Text(raw: string): string {
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\-. $/+%]/g, "")
    .replace(/\s+/g, " ");
  return cleaned.slice(0, 32) || "UNKNOWN";
}

/** PNG data-URL of a Code 39 barcode for embedding in SVG. */
export async function code39DataUrl(
  text: string,
  opts?: { width?: number; height?: number },
): Promise<string> {
  const value = toCode39Text(text);
  const png = await bwipjs.toBuffer({
    bcid: "code39",
    text: value,
    scale: 3,
    height: 12,
    includetext: false,
    paddingwidth: 2,
    paddingheight: 2,
    backgroundcolor: "F5F0E1",
    barcolor: "1A1210",
  });
  // Optional resize to target slot via sharp is done by the SVG image box;
  // return raw PNG data URL. width/height reserved for future use.
  void opts;
  return `data:image/png;base64,${png.toString("base64")}`;
}
