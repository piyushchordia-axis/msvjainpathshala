#!/usr/bin/env node
/**
 * Step 11 smoke — render the ID-card Handlebars template + write the PNG
 * to MinIO. Mirrors what the BullMQ worker does but with synthetic data
 * (no Drizzle access needed).
 *
 * Output:
 *   - prints the resolved verify URL + asset key
 *   - writes the PNG to `infra/scratch/id-card-smoke.png` for visual inspection
 *   - uploads to `jp/jp-dev-media-public/idcards/{uuid}.png` and prints the
 *     public URL so you can open it in a browser
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import Handlebars from 'handlebars';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(__dirname, '..', 'src', 'templates', 'id-card.hbs');
const SCRATCH_DIR = join(__dirname, '..', '..', '..', 'infra', 'scratch');
if (!existsSync(SCRATCH_DIR)) mkdirSync(SCRATCH_DIR, { recursive: true });

const studentId = randomUUID();
const studentCode = 'JP-PUN-0428';
const shortUuid = studentId.replace(/-/g, '').slice(0, 12);
const qrUrl = `https://jainpathshala.org/s/${shortUuid}`;
const qrSig = createHmac('sha256', 'jp-dev-qr-secret')
  .update(`${studentId}:${shortUuid}`)
  .digest('hex');

const qrPng = await QRCode.toBuffer(qrUrl, {
  type: 'png',
  errorCorrectionLevel: 'M',
  margin: 1,
  width: 256,
  color: { dark: '#1A0A00', light: '#FFFFFF' },
});

const tmpl = Handlebars.compile(readFileSync(TEMPLATE, 'utf8'));
const html = tmpl({
  student_name_en: 'Aarav Rajesh Mehta',
  student_name_hi: 'आरव राजेश मेहता',
  father_name: 'Rajesh Mehta',
  photo_url: '',
  photo_initials: 'AR',
  student_id: studentCode,
  centre_name_en: 'Mahavir, Pune',
  centre_name_hi: 'महावीर, पुणे',
  batch_name_en: 'Tarun · Saturday 17:00–19:00',
  batch_name_hi: 'तरुण · शनिवार',
  qr_code_url: `data:image/png;base64,${qrPng.toString('base64')}`,
  msv_badge: true,
  valid_year: '2025–26',
  verify_url: `jainpathshala.app/v/${studentCode}`,
  tier_label_en: 'Sadhak',
  tier_label_hi: 'साधक',
  tier_color: '#1E3A8A',
  dob_display: '12 Aug 2011',
});

console.log(`[smoke] template rendered (${html.length} bytes)`);
const htmlPath = join(SCRATCH_DIR, 'id-card-smoke.html');
writeFileSync(htmlPath, html);
console.log(`[smoke] HTML preview written to ${htmlPath}`);

// ----- Render PNG via the same sharp/SVG fallback the worker uses ----------
const pick = (re) => html.match(re)?.[1]?.trim() ?? '';
const studentNameEn = pick(/class="name-en">([^<]+)</);
const studentNameHi = pick(/class="name-hi">([^<]+)</);
const sid = pick(/class="val mono">([^<]+)</);
const dobLine = pick(/class="meta-line">([^<]+)</);
const centreName = pick(/<div class="lbl">Centre<\/div>\s*<div class="val">([^<]+)</);
const batchName = pick(/<div class="lbl">Batch<\/div>\s*<div class="val">([^<]+)</);
const validYear = pick(/Student Identity Card · ([^<]+)<\/div>/);
const verifyUrl = pick(/class="verify">([^<]+)</);
const qrMatch = html.match(/<img src="(data:image\/png;base64,[^"]+)"/);
const qrDataUrl = qrMatch?.[1] ?? '';
const hasMsv = /class="msv-badge"/.test(html);

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const cardSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="340" viewBox="0 0 540 340">
  <defs>
    <linearGradient id="band" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#7A1818"/>
      <stop offset="1" stop-color="#5C1010"/>
    </linearGradient>
    <linearGradient id="logo" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#E8A06A"/>
      <stop offset="1" stop-color="#D4621A"/>
    </linearGradient>
    <linearGradient id="msv" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#E6C26B"/>
      <stop offset="1" stop-color="#C8941F"/>
    </linearGradient>
    <clipPath id="cc">
      <rect width="540" height="340" rx="16"/>
    </clipPath>
  </defs>
  <g clip-path="url(#cc)">
    <rect width="540" height="340" fill="#FFFFFF"/>
    <rect width="540" height="80" fill="url(#band)"/>
    <rect x="18" y="22" width="36" height="36" rx="8" fill="url(#logo)"/>
    <text x="36" y="50" text-anchor="middle" font-family="Georgia" font-size="22" fill="#FFFFFF">ज</text>
    <text x="64" y="38" font-family="Georgia" font-size="18" fill="#FDF8F2">Jain Pathshala</text>
    <text x="64" y="54" font-size="9" letter-spacing="1.2" fill="#E8A06A">STUDENT IDENTITY CARD · ${esc(validYear)}</text>
    ${hasMsv ? '<rect x="478" y="30" width="44" height="22" rx="6" fill="url(#msv)"/><text x="500" y="46" text-anchor="middle" font-size="10" font-weight="800" letter-spacing="1.5" fill="#5C1010">MSV</text>' : ''}
    <rect x="18" y="98" width="120" height="144" rx="8" fill="url(#logo)"/>
    <text x="78" y="180" text-anchor="middle" font-family="Georgia" font-size="40" fill="#FFFFFF">AR</text>
    <text x="156" y="116" font-family="Georgia" font-size="22" fill="#7A1818">${esc(studentNameEn)}</text>
    <text x="156" y="134" font-family="Georgia" font-size="13" fill="#7A1818">${esc(studentNameHi)}</text>
    <text x="156" y="150" font-size="11" fill="#8B6F5E">${esc(dobLine)}</text>
    <g font-size="11">
      <text x="156" y="178" fill="#8B6F5E">Student ID</text>
      <text x="240" y="178" font-family="monospace" font-weight="600" fill="#1A0A00">${esc(sid)}</text>
      <text x="156" y="198" fill="#8B6F5E">Centre</text>
      <text x="240" y="198" font-weight="600" fill="#1A0A00">${esc(centreName)}</text>
      <text x="156" y="218" fill="#8B6F5E">Batch</text>
      <text x="240" y="218" font-weight="600" fill="#1A0A00">${esc(batchName)}</text>
      <text x="156" y="238" fill="#8B6F5E">Tier</text>
      <circle cx="244" cy="234" r="4" fill="#1E3A8A"/>
      <text x="254" y="238" font-family="Georgia" font-weight="600" fill="#1E3A8A">Sadhak</text>
    </g>
    <rect x="430" y="118" width="92" height="92" rx="6" fill="#FFFFFF" stroke="#E6D8C2"/>
    ${qrDataUrl ? `<image x="436" y="124" width="80" height="80" href="${qrDataUrl}"/>` : ''}
    <text x="476" y="226" text-anchor="middle" font-family="monospace" font-size="10" fill="#8B6F5E">verify</text>
    <rect x="0" y="316" width="540" height="24" fill="#F5EDE0"/>
    <text x="18" y="332" font-size="10" fill="#8B6F5E">Valid until 31 Mar ${esc(validYear)} · Property of Jain Pathshala Trust</text>
    <text x="522" y="332" text-anchor="end" font-family="monospace" font-size="10" fill="#8B6F5E">${esc(verifyUrl)}</text>
  </g>
  <rect x="0.5" y="0.5" width="539" height="339" rx="16" fill="none" stroke="#E6D8C2"/>
</svg>`;

const cardPng = await sharp(Buffer.from(cardSvg)).png().toBuffer();
const final = await sharp({
  create: {
    width: 1080,
    height: 1700,
    channels: 4,
    background: { r: 253, g: 248, b: 242, alpha: 1 },
  },
})
  .composite([
    {
      input: await sharp(cardPng).resize({ width: 980, fit: 'contain' }).toBuffer(),
      gravity: 'centre',
    },
  ])
  .png()
  .toBuffer();

const pngPath = join(SCRATCH_DIR, 'id-card-smoke.png');
writeFileSync(pngPath, final);
console.log(`[smoke] PNG (${final.length} bytes, 1080x1700) → ${pngPath}`);

// Upload to public bucket
const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://localhost:9000',
  credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
  forcePathStyle: true,
});
const objectKey = `idcards/${studentId}.png`;
await s3.send(
  new PutObjectCommand({
    Bucket: 'jp-dev-media-public',
    Key: objectKey,
    Body: final,
    ContentType: 'image/png',
    CacheControl: 'public,max-age=31536000,immutable',
  }),
);
const publicUrl = `http://localhost:9000/jp-dev-media-public/${objectKey}`;
console.log(`[smoke] uploaded → ${publicUrl}`);
console.log(`[smoke] QR encodes: ${qrUrl}`);
console.log(`[smoke] QR HMAC sig: ${qrSig.slice(0, 16)}…`);
console.log('[smoke] ✅ ID card rendered + uploaded — open the URL above to inspect');
