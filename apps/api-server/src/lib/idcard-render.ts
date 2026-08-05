/**
 * Shared digital ID-card SVG/PNG rendering — Megh Sanskar Vatika / Ascetic Precision.
 * Used by admin generate, seed script, and owner photo updates.
 */
import { alias } from "drizzle-orm/pg-core";
import { db, digital_id_cards, students, centres, users, cities } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Readable } from "node:stream";
import sharp from "sharp";
import { code39DataUrl } from "./barcode";
import { svgToPng } from "./qr";
import { storage, makeKey } from "./storage";
import { uploadKeyFromUrl } from "./file-tokens";
import { buildCardPayload, signCardPayload } from "./idcard-crypto";

/** Portrait ID — proportions aligned to Ascetic Precision mockup (barcode band). */
export const ID_CARD_W = 480;
export const ID_CARD_H = 640;

const C = {
  maroon: "#4A0E1C",
  maroonDeep: "#3A0A16",
  cream: "#F5F0E1",
  creamSoft: "#EDE6D4",
  gold: "#B08D57",
  goldSoft: "#C4A574",
  ink: "#1A1210",
  inkMuted: "#3D2E28",
  photoBg: "#E8E0D0",
  msv: "#C45C26",
} as const;

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
      .resize(280, 340, { fit: "cover", position: "centre" })
      .jpeg({ quality: 88 })
      .toBuffer();
    return `data:image/jpeg;base64,${resized.toString("base64")}`;
  } catch {
    return null;
  }
}

function academicSession(d = new Date()): string {
  const y = d.getFullYear();
  const m = d.getMonth();
  if (m >= 3) return `${y} – ${String(y + 1).slice(-2)}`;
  return `${y - 1} – ${String(y).slice(-2)}`;
}

function formatMobile(phone: string | null | undefined): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  return phone;
}

function clipField(value: string, max: number): string {
  const t = value.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** Pathshala title up to 32 chars — scale type so the header stays balanced. */
function pathshalaTitleLayout(name: string): { text: string; fontSize: number; headerH: number; titleY: number } {
  const text = clipField(name.trim() || "Jain Pathshala", 32);
  const len = text.length;
  if (len <= 14) return { text, fontSize: 34, headerH: 138, titleY: 78 };
  if (len <= 22) return { text, fontSize: 28, headerH: 144, titleY: 80 };
  if (len <= 28) return { text, fontSize: 24, headerH: 150, titleY: 82 };
  return { text, fontSize: 20, headerH: 156, titleY: 84 };
}

/** Subtle radial arcs in the header — labour-of-marks, not decoration. */
function guillocheMark(cx: number, cy: number): string {
  const rings = [36, 54, 74, 96, 120, 148, 178];
  return rings
    .map(
      (r, i) =>
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.goldSoft}" stroke-width="${i % 2 === 0 ? 0.55 : 0.3}" opacity="${0.22 - i * 0.015}"/>`,
    )
    .join("\n");
}

/** Soft mandala watermark behind body content (matches mockup atmosphere). */
function bodyWatermark(cx: number, cy: number): string {
  const rings = [40, 70, 100, 130, 160];
  return `<g opacity="0.07">
    ${rings
      .map(
        (r, i) =>
          `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.maroon}" stroke-width="${i % 2 === 0 ? 0.8 : 0.4}"/>`,
      )
      .join("\n")}
    <circle cx="${cx}" cy="${cy}" r="18" fill="none" stroke="${C.maroon}" stroke-width="0.6"/>
  </g>`;
}

function crescentIcon(x: number, y: number): string {
  return `<g transform="translate(${x},${y})">
    <circle cx="8" cy="10" r="7" fill="none" stroke="${C.gold}" stroke-width="1.4"/>
    <circle cx="11" cy="8" r="6" fill="${C.maroon}"/>
    <circle cx="8" cy="2.5" r="1.4" fill="${C.gold}"/>
  </g>`;
}

function cropMarks(x: number, y: number, w: number, h: number): string {
  const m = 8;
  return `<g>
    <path d="M${x} ${y + m} V${y} H${x + m}" fill="none" stroke="${C.maroon}" stroke-width="1.3"/>
    <path d="M${x + w - m} ${y} H${x + w} V${y + m}" fill="none" stroke="${C.maroon}" stroke-width="1.3"/>
    <path d="M${x} ${y + h - m} V${y + h} H${x + m}" fill="none" stroke="${C.maroon}" stroke-width="1.3"/>
    <path d="M${x + w - m} ${y + h} H${x + w} V${y + h - m}" fill="none" stroke="${C.maroon}" stroke-width="1.3"/>
  </g>`;
}

function photoBlockSvg(
  x: number,
  y: number,
  w: number,
  h: number,
  photoDataUrl?: string | null,
): string {
  if (photoDataUrl) {
    return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.photoBg}"/>
    <image x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" href="${photoDataUrl}" xlink:href="${photoDataUrl}" preserveAspectRatio="xMidYMid slice"/>
    ${cropMarks(x, y, w, h)}
  </g>`;
  }
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.photoBg}" stroke="${C.maroon}" stroke-width="0.6"/>
    ${cropMarks(x, y, w, h)}
    <text x="${x + w / 2}" y="${y + h - 14}" font-family="Arial, Helvetica, sans-serif" font-size="9" letter-spacing="2" fill="${C.gold}" text-anchor="middle">PHOTOGRAPH</text>
  </g>`;
}

/**
 * Compose the portrait Megh Sanskar Vatika student identity card.
 * Palette / hierarchy follow Ascetic Precision + the approved mockup (Code 39 band).
 */
export function buildCardSvg(opts: {
  fullName: string;
  studentCode: string;
  centreName: string;
  cityName?: string | null;
  cardNumber: string;
  msvBadge: boolean;
  barcodeImage: string;
  photoDataUrl?: string | null;
  parentName?: string | null;
  guardianRelation?: string | null;
  mobile?: string | null;
  bloodGroup?: string | null;
  sessionLabel?: string | null;
  /** Pathshala display name — up to 32 characters in the maroon header. */
  pathshalaName?: string | null;
}): string {
  const {
    fullName,
    studentCode,
    centreName,
    cityName,
    cardNumber,
    msvBadge,
    barcodeImage,
    photoDataUrl,
    parentName,
    guardianRelation,
    mobile,
    bloodGroup,
    sessionLabel,
    pathshalaName,
  } = opts;

  const enrolment = studentCode || cardNumber;
  const session = sessionLabel ?? academicSession();
  const mobileDisp = formatMobile(mobile);
  const parentDisp = clipField((parentName && parentName.trim()) || "—", 18);
  const bloodDisp = (bloodGroup && bloodGroup.trim()) || "—";
  const parentLabel =
    guardianRelation === "father"
      ? "FATHER"
      : guardianRelation === "mother"
        ? "MOTHER"
        : guardianRelation === "guardian"
          ? "GUARDIAN"
          : "FATHER / GUARDIAN";
  const centreLabel = cityName ? `CENTRE · ${clipField(cityName.toUpperCase(), 12)}` : "CENTRE";
  const centreDisp = clipField(centreName || "—", 16);
  const title = pathshalaTitleLayout(pathshalaName ?? "Jain Pathshala");

  const photoX = 28;
  const photoY = title.headerH + 20;
  const photoW = 148;
  const photoH = 178;

  const photoBlock = photoBlockSvg(photoX, photoY, photoW, photoH, photoDataUrl);

  const msvBanner = msvBadge
    ? `<rect x="196" y="${photoY + photoH - 24}" width="256" height="22" fill="${C.msv}"/>
  <text x="324" y="${photoY + photoH - 9}" font-family="Arial, Helvetica, sans-serif" font-size="8" font-weight="700" letter-spacing="0.6" fill="#ffffff" text-anchor="middle">MSV EXCLUSIVE PROGRAMME ENROLLED MEMBER</text>`
    : "";

  const metaY0 = photoY + 22;
  const metaGap = 50;
  const metaRows = [
    { label: "ENROLMENT NO.", value: enrolment },
    { label: "SESSION", value: session },
    { label: "MOBILE", value: mobileDisp },
  ];
  const metaBlock = metaRows
    .map((row, i) => {
      const y = metaY0 + i * metaGap;
      return `<text x="196" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="9" letter-spacing="1.8" fill="${C.gold}">${row.label}</text>
  <text x="196" y="${y + 20}" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="${C.maroon}">${escXml(row.value)}</text>
  ${i < metaRows.length - 1 ? `<line x1="196" y1="${y + 32}" x2="452" y2="${y + 32}" stroke="${C.maroon}" stroke-width="0.5" opacity="0.4"/>` : ""}`;
    })
    .join("\n");

  const nameY = photoY + photoH + (msvBadge ? 36 : 28);
  const gridY = nameY + 62;
  const colW = 140;
  const col0 = 28;
  const col1 = col0 + colW + 12;
  const col2 = col1 + colW + 12;

  const footerH = 56;
  const footerY = ID_CARD_H - footerH;
  const barcodeH = 56;
  const barcodeW = 424;
  const barcodeX = 28;
  /** Prefer just under the grid; clamp so captions clear the footer. */
  const barcodeY = Math.min(gridY + 40, footerY - 82);
  const captionY = Math.min(barcodeY + barcodeH + 14, footerY - 10);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${ID_CARD_W}" height="${ID_CARD_H}" viewBox="0 0 ${ID_CARD_W} ${ID_CARD_H}">
  <defs>
    <clipPath id="cardClip"><rect width="${ID_CARD_W}" height="${ID_CARD_H}" rx="6"/></clipPath>
  </defs>
  <g clip-path="url(#cardClip)">
    <rect width="${ID_CARD_W}" height="${ID_CARD_H}" fill="${C.cream}"/>
    ${bodyWatermark(240, 380)}

    <!-- Header mass -->
    <rect x="0" y="0" width="${ID_CARD_W}" height="${title.headerH}" fill="${C.maroon}"/>
    ${guillocheMark(455, -10)}
    ${crescentIcon(28, 22)}
    <text x="52" y="38" font-family="Arial, Helvetica, sans-serif" font-size="9" letter-spacing="3.2" fill="${C.gold}" opacity="0.95">MEGH SANSKAR VATIKA</text>
    <text x="28" y="${title.titleY}" font-family="Georgia, 'Times New Roman', serif" font-size="${title.fontSize}" fill="#ffffff">${escXml(title.text)}</text>
    <text x="28" y="${title.headerH - 28}" font-family="Arial, Helvetica, sans-serif" font-size="11" letter-spacing="2.4" fill="${C.gold}">IDENTITY CARD · STUDENT</text>

    <!-- Body -->
    ${photoBlock}
    ${metaBlock}
    ${msvBanner}
    <line x1="28" y1="${nameY - 14}" x2="452" y2="${nameY - 14}" stroke="${C.maroon}" stroke-width="0.5" opacity="0.4"/>

    <text x="28" y="${nameY}" font-family="Arial, Helvetica, sans-serif" font-size="9" letter-spacing="1.8" fill="${C.gold}">NAME OF STUDENT</text>
    <text x="28" y="${nameY + 34}" font-family="Georgia, 'Times New Roman', serif" font-size="28" font-weight="700" fill="${C.maroon}">${escXml(fullName)}</text>
    <line x1="28" y1="${nameY + 48}" x2="452" y2="${nameY + 48}" stroke="${C.maroon}" stroke-width="0.5" opacity="0.45"/>

    <line x1="${col1 - 6}" y1="${gridY - 4}" x2="${col1 - 6}" y2="${gridY + 40}" stroke="${C.maroon}" stroke-width="0.4" opacity="0.35"/>
    <line x1="${col2 - 6}" y1="${gridY - 4}" x2="${col2 - 6}" y2="${gridY + 40}" stroke="${C.maroon}" stroke-width="0.4" opacity="0.35"/>

    <text x="${col0}" y="${gridY}" font-family="Arial, Helvetica, sans-serif" font-size="8" letter-spacing="1.2" fill="${C.gold}">${parentLabel}</text>
    <text x="${col0}" y="${gridY + 20}" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700" fill="${C.maroon}">${escXml(parentDisp)}</text>

    <text x="${col1}" y="${gridY}" font-family="Arial, Helvetica, sans-serif" font-size="8" letter-spacing="1.2" fill="${C.gold}">${escXml(centreLabel)}</text>
    <text x="${col1}" y="${gridY + 20}" font-family="Georgia, 'Times New Roman', serif" font-size="14" font-weight="700" fill="${C.maroon}">${escXml(centreDisp)}</text>

    <text x="${col2}" y="${gridY}" font-family="Arial, Helvetica, sans-serif" font-size="8" letter-spacing="1.2" fill="${C.gold}">BLOOD</text>
    <text x="${col2}" y="${gridY + 20}" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700" fill="${C.maroon}">${escXml(bloodDisp)}</text>

    <!-- Code 39 verify band -->
    <image x="${barcodeX}" y="${barcodeY}" width="${barcodeW}" height="${barcodeH}" href="${barcodeImage}" xlink:href="${barcodeImage}" preserveAspectRatio="none"/>
    <text x="28" y="${captionY}" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="600" fill="${C.maroon}">${escXml(enrolment)}</text>
    <text x="452" y="${captionY}" font-family="Arial, Helvetica, sans-serif" font-size="9" letter-spacing="1.2" fill="${C.gold}" text-anchor="end">CODE 39 · SCAN TO VERIFY</text>

    <!-- Footer -->
    <rect x="0" y="${footerY}" width="${ID_CARD_W}" height="${footerH}" fill="${C.maroonDeep}"/>
    <text x="240" y="${footerY + 18}" font-family="Arial, Helvetica, sans-serif" font-size="7" letter-spacing="1.4" fill="${C.goldSoft}" text-anchor="middle" opacity="0.45">MEGHSANSKARVATIKA · JAINPATHSHALA · MEGHSANSKARVATIKA · JAINPATHSHALA</text>
    <text x="240" y="${footerY + 40}" font-family="Arial, Helvetica, sans-serif" font-size="9" letter-spacing="1.6" fill="#ffffff" text-anchor="middle">PROPERTY OF MEGH SANSKAR VATIKA · RETURN TO ANY CENTRE</text>
  </g>
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
  /** ISO timestamp of this art render — use as a client cache-buster. */
  last_regenerated_at: string;
};

async function loadCardContext(studentId: string) {
  const parentUsers = alias(users, "parent_users");
  const studentUsers = alias(users, "student_users");
  const [row] = await db
    .select({
      full_name: students.full_name,
      student_code: students.student_code,
      photo_url: students.photo_url,
      blood_group: students.blood_group,
      guardian_relation: students.guardian_relation,
      msv_status: students.msv_status,
      msv_code: students.msv_code,
      centre_name: centres.name,
      city_name: cities.name,
      parent_name: parentUsers.full_name,
      parent_phone: parentUsers.phone,
      student_phone: studentUsers.phone,
    })
    .from(students)
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .leftJoin(cities, eq(cities.id, centres.city_id))
    .leftJoin(parentUsers, eq(parentUsers.id, students.parent_id))
    .leftJoin(studentUsers, eq(studentUsers.id, students.user_id))
    .where(eq(students.id, studentId))
    .limit(1);
  return row ?? null;
}

/**
 * Render and store an ID-card PNG for a student.
 * When `rotateQr` is false and a card already exists, keeps signed payload/version
 * so API verify stays valid after photo-only updates. Visual uses a unique Code 39
 * barcode from the student enrolment code.
 */
export async function upsertIdCardArt(opts: {
  studentId: string;
  fullName: string;
  studentCode: string;
  centreName: string;
  msvBadge: boolean;
  photoUrl?: string | null;
  rotateQr: boolean;
  pathshalaName?: string | null;
}): Promise<UpsertIdCardResult> {
  const { studentId, rotateQr } = opts;
  const ctx = await loadCardContext(studentId);

  const fullName = ctx?.full_name ?? opts.fullName;
  const studentCode = ctx?.student_code ?? opts.studentCode;
  const centreName = ctx?.centre_name ?? opts.centreName;
  const msvBadge = ctx ? ctx.msv_status === "approved" : opts.msvBadge;
  const photoUrl = opts.photoUrl !== undefined ? opts.photoUrl : ctx?.photo_url;
  const cityName = ctx?.city_name ?? null;
  const parentName = ctx?.parent_name ?? null;
  const mobile = ctx?.student_phone ?? ctx?.parent_phone ?? null;
  const bloodGroup = ctx?.blood_group ?? null;
  const guardianRelation = ctx?.guardian_relation ?? null;
  const pathshalaName = opts.pathshalaName ?? "Jain Pathshala";

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
  const cardNumber = existing?.card_number ?? ctx?.msv_code ?? studentCode;

  let qr_payload = existing?.qr_payload ?? null;
  let qr_signature = existing?.qr_signature ?? null;
  if (!qr_payload || !qr_signature || rotateQr || !existing) {
    ({ qr_payload, qr_signature } = signPayload(studentId, cardNumber, versionNo));
  }

  const [barcodeImage, photoDataUrl] = await Promise.all([
    code39DataUrl(studentCode || cardNumber),
    loadPhotoDataUrl(photoUrl),
  ]);

  const svg = buildCardSvg({
    fullName,
    studentCode,
    centreName,
    cityName,
    cardNumber,
    msvBadge,
    barcodeImage,
    photoDataUrl,
    parentName,
    guardianRelation,
    mobile,
    bloodGroup,
    sessionLabel: academicSession(),
    pathshalaName,
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
    last_regenerated_at: now.toISOString(),
  };
}
