/**
 * Shared digital ID-card SVG/PNG rendering.
 * Used by admin generate, seed script, and owner photo updates.
 */
import { db, digital_id_cards } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Readable } from "node:stream";
import sharp from "sharp";
import { qrDataUrl, svgToPng } from "./qr";
import { storage, makeKey } from "./storage";
import { uploadKeyFromUrl } from "./file-tokens";
import { buildCardPayload, signCardPayload } from "./idcard-crypto";

export function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Load a stored student photo as a data-URL suitable for embedding in SVG. */
export async function loadPhotoDataUrl(photoUrl: string | null | undefined): Promise<string | null> {
  if (!photoUrl) return null;
  const key = uploadKeyFromUrl(photoUrl);
  if (!key) return null;
  try {
    const raw = await streamToBuffer(storage.getStream(key) as unknown as Readable);
    const resized = await sharp(raw)
      .rotate()
      .resize(220, 280, { fit: "cover", position: "centre" })
      .jpeg({ quality: 85 })
      .toBuffer();
    return `data:image/jpeg;base64,${resized.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Compose the ~600x380 SVG ID card (optional headshot on the left). */
export function buildCardSvg(opts: {
  fullName: string;
  studentCode: string;
  centreName: string;
  cardNumber: string;
  msvBadge: boolean;
  qrImage: string;
  photoDataUrl?: string | null;
}): string {
  const { fullName, studentCode, centreName, cardNumber, msvBadge, qrImage, photoDataUrl } = opts;
  const badge = msvBadge
    ? `<g>
         <rect x="170" y="300" width="150" height="34" rx="17" fill="#16a34a" />
         <text x="245" y="322" font-family="Arial, sans-serif" font-size="15" font-weight="bold" fill="#ffffff" text-anchor="middle">MSV MEMBER</text>
       </g>`
    : "";
  const photoBlock = photoDataUrl
    ? `<rect x="36" y="95" width="118" height="148" rx="10" fill="#f3f4f6" stroke="#e5e7eb" stroke-width="2" />
  <image x="40" y="99" width="110" height="140" href="${photoDataUrl}" preserveAspectRatio="xMidYMid slice" />`
    : `<rect x="36" y="95" width="118" height="148" rx="10" fill="#f3f4f6" stroke="#e5e7eb" stroke-width="2" />
  <circle cx="95" cy="150" r="28" fill="#d1d5db" />
  <rect x="62" y="185" width="66" height="40" rx="20" fill="#d1d5db" />
  <text x="95" y="245" font-family="Arial, sans-serif" font-size="12" fill="#6b7280" text-anchor="middle">Photo</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="380" viewBox="0 0 600 380">
  <rect x="0" y="0" width="600" height="380" rx="18" fill="#ffffff" stroke="#e5e7eb" stroke-width="2" />
  <rect x="0" y="0" width="600" height="70" rx="18" fill="#7c3aed" />
  <rect x="0" y="40" width="600" height="30" fill="#7c3aed" />
  <text x="40" y="46" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="#ffffff">Jain Pathshala</text>
  <text x="40" y="64" font-family="Arial, sans-serif" font-size="13" fill="#ede9fe">Digital ID Card</text>
  ${photoBlock}
  <text x="170" y="130" font-family="Arial, sans-serif" font-size="15" fill="#6b7280">Name</text>
  <text x="170" y="158" font-family="Arial, sans-serif" font-size="24" font-weight="bold" fill="#111827">${escXml(fullName)}</text>
  <text x="170" y="200" font-family="Arial, sans-serif" font-size="15" fill="#6b7280">Student Code</text>
  <text x="170" y="224" font-family="Arial, sans-serif" font-size="18" fill="#111827">${escXml(studentCode)}</text>
  <text x="170" y="258" font-family="Arial, sans-serif" font-size="15" fill="#6b7280">Centre</text>
  <text x="170" y="282" font-family="Arial, sans-serif" font-size="18" fill="#111827">${escXml(centreName)}</text>
  ${badge}
  <image x="400" y="120" width="170" height="170" href="${qrImage}" />
  <text x="485" y="306" font-family="Arial, sans-serif" font-size="13" fill="#6b7280" text-anchor="middle">Scan to verify</text>
  <text x="40" y="354" font-family="Arial, sans-serif" font-size="14" fill="#374151">Card No: ${escXml(cardNumber)}</text>
</svg>`;
}

function signPayload(studentId: string, cardNumber: string, versionNo: number) {
  const qr_payload = buildCardPayload({ student_id: studentId, card_number: cardNumber, v: versionNo });
  const qr_signature = signCardPayload(qr_payload);
  return { qr_payload, qr_signature };
}

export type UpsertIdCardResult = {
  student_id: string;
  card_number: string;
  png_url: string;
  version_no: number;
  is_active: boolean;
};

/**
 * Render and store an ID-card PNG for a student.
 * When `rotateQr` is false and a card already exists, keeps QR payload/version
 * so scanners stay valid after photo-only updates.
 */
export async function upsertIdCardArt(opts: {
  studentId: string;
  fullName: string;
  studentCode: string;
  centreName: string;
  msvBadge: boolean;
  photoUrl?: string | null;
  rotateQr: boolean;
}): Promise<UpsertIdCardResult> {
  const { studentId, fullName, studentCode, centreName, msvBadge, photoUrl, rotateQr } = opts;

  const [existing] = await db
    .select({
      version_no: digital_id_cards.version_no,
      png_url: digital_id_cards.png_url,
      card_number: digital_id_cards.card_number,
      qr_payload: digital_id_cards.qr_payload,
      qr_signature: digital_id_cards.qr_signature,
    })
    .from(digital_id_cards)
    .where(eq(digital_id_cards.student_id, studentId))
    .limit(1);

  const versionNo = existing ? (rotateQr ? existing.version_no + 1 : existing.version_no) : 1;
  const cardNumber = existing?.card_number ?? `MSV-${studentCode}`;

  let qr_payload = existing?.qr_payload ?? null;
  let qr_signature = existing?.qr_signature ?? null;
  if (!qr_payload || !qr_signature || rotateQr || !existing) {
    ({ qr_payload, qr_signature } = signPayload(studentId, cardNumber, versionNo));
  }

  const [qrImage, photoDataUrl] = await Promise.all([
    qrDataUrl(qr_payload, 340),
    loadPhotoDataUrl(photoUrl),
  ]);

  const svg = buildCardSvg({
    fullName,
    studentCode,
    centreName,
    cardNumber,
    msvBadge,
    qrImage,
    photoDataUrl,
  });
  const png = await svgToPng(svg);
  const { url } = await storage.put(makeKey("id-cards", `${cardNumber}.png`), png, "image/png");

  if (existing?.png_url) {
    const oldKey = uploadKeyFromUrl(existing.png_url);
    if (oldKey) await storage.remove(oldKey);
  }

  const now = new Date();
  const [row] = await db
    .insert(digital_id_cards)
    .values({
      student_id: studentId,
      qr_token: qr_signature.slice(0, 32),
      card_number: cardNumber,
      qr_payload,
      qr_signature,
      png_url: url,
      svg_payload: svg,
      msv_badge: msvBadge,
      version_no: versionNo,
      generated_at: now,
      last_regenerated_at: existing ? now : null,
      is_active: true,
    })
    .onConflictDoUpdate({
      target: digital_id_cards.student_id,
      set: {
        qr_token: qr_signature.slice(0, 32),
        card_number: cardNumber,
        qr_payload,
        qr_signature,
        png_url: url,
        svg_payload: svg,
        msv_badge: msvBadge,
        version_no: versionNo,
        last_regenerated_at: now,
        is_active: true,
      },
    })
    .returning({
      student_id: digital_id_cards.student_id,
      card_number: digital_id_cards.card_number,
      png_url: digital_id_cards.png_url,
      version_no: digital_id_cards.version_no,
      is_active: digital_id_cards.is_active,
    });

  return {
    student_id: row!.student_id,
    card_number: row!.card_number!,
    png_url: row!.png_url!,
    version_no: row!.version_no,
    is_active: row!.is_active,
  };
}
