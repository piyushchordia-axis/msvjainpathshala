/**
 * QR code + image helpers. `qrPngBuffer`/`qrDataUrl` use the pure-JS `qrcode`
 * lib; `svgToPng` rasterizes an SVG card layout via `sharp` (native, externalized
 * in build.mjs). Used by Digital ID Cards and any QR-bearing module.
 */
import QRCode from "qrcode";
import sharp from "sharp";

/** PNG bytes for the given payload (default 512px, high error correction). */
export async function qrPngBuffer(data: string, size = 512): Promise<Buffer> {
  return QRCode.toBuffer(data, {
    type: "png",
    errorCorrectionLevel: "H",
    margin: 1,
    width: size,
  });
}

/** A `data:image/png;base64,...` URL for embedding a QR inside an SVG. */
export async function qrDataUrl(data: string, size = 512): Promise<string> {
  return QRCode.toDataURL(data, { errorCorrectionLevel: "H", margin: 1, width: size });
}

/** Rasterize an SVG string to PNG bytes (e.g. a composed ID-card layout). */
export async function svgToPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer();
}
