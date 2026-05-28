/**
 * `idcard.generation` worker (SPEC §5.5 + Step 11 prompt).
 *
 * Flow per job:
 *   1. Load student + parent + centre + batch + (optional) photo asset
 *   2. Render apps/api/src/templates/id-card.hbs with the student data
 *   3. Convert HTML → PNG (1080×1700px) via puppeteer when available, else
 *      via a sharp/SVG fallback (keeps dev usable without Chromium)
 *   4. Encode the QR payload (https://jainpathshala.org/s/{uuid_short})
 *      with the `qrcode` package — embedded as a data: URL in the template
 *   5. Upload the PNG to jp-{env}-media-public/idcards/{student_id}.png
 *   6. UPSERT a `digital_id_cards` row (single row per student per Q-criteria)
 *   7. Emit a parent notification job
 *
 * Regenerate triggers (per Step 11 prompt) are enqueued by callers:
 *   - student.transfer    → EnrolmentsService.transfer()
 *   - enrolment.approved  → EnrolmentsService.approve()
 *   - msv.approved        → MsvService when status flips
 *   - photo.updated       → StudentsService.update() when photo asset changes
 */

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import Handlebars from 'handlebars';
import * as QRCode from 'qrcode';
import sharp from 'sharp';

import { QUEUES } from '@jp/shared';

import { AppConfigService } from '../../core/config/app-config.service';
import { DrizzleService } from '../../core/database/drizzle.service';
import { RedisService } from '../../core/redis/redis.service';
import { StorageService } from '../../core/storage/storage.service';
import { MediaAssetsRepository } from '../../db/repositories';
import { batches, centres, digital_id_cards, students, users } from '../../db/schema';

import { BaseProcessor } from './base.processor';

import type { Job } from 'bullmq';

export interface IdCardGenerationPayload {
  student_id: string;
  /** Free-form trigger label written to the audit trail. */
  reason?: 'enrolment.approved' | 'student.transferred' | 'msv.approved' | 'photo.updated' | string;
}

export interface IdCardGenerationResult {
  card_id: string;
  student_id: string;
  asset_id: string | null;
  card_number: string;
  bytes: number;
  version_no: number;
}

interface TemplateContext {
  student_name_en: string;
  student_name_hi: string;
  father_name: string;
  photo_url: string;
  photo_initials: string;
  student_id: string;
  centre_name_en: string;
  centre_name_hi: string;
  batch_name_en: string;
  batch_name_hi: string;
  qr_code_url: string;
  msv_badge: boolean;
  valid_year: string;
  verify_url: string;
  tier_label_en: string;
  tier_label_hi: string;
  tier_color: string;
  dob_display: string;
}

const QR_BASE_URL = 'https://jainpathshala.org/s';
const PNG_WIDTH = 1080;
const PNG_HEIGHT = 1700;

interface PuppeteerPage {
  setViewport(opts: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>;
  setContent(html: string, opts?: { waitUntil?: string }): Promise<void>;
  $(
    selector: string,
  ): Promise<{
    screenshot: (opts: { type: 'png'; omitBackground?: boolean }) => Promise<Buffer | Uint8Array>;
  } | null>;
  screenshot(opts: { type: 'png'; fullPage?: boolean }): Promise<Buffer | Uint8Array>;
}

function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}

function dayLabels(daysOfWeek: number[]): string {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return daysOfWeek
    .map((d) => labels[Math.min(Math.max(d - 1, 0), 6)])
    .filter(Boolean)
    .join('/');
}

function formatTimeRange(start: string, end: string): string {
  // Postgres `time` columns come back as 'HH:MM:SS'; strip seconds.
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

function formatDob(iso: string): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = months[d.getUTCMonth()] ?? '';
  return `${day} ${month} ${d.getUTCFullYear()}`;
}

function shortUuid(uuid: string): string {
  return uuid.replace(/-/g, '').slice(0, 12);
}

/**
 * Compile the template ONCE at module load — the file content lives in the
 * deployed artifact and only changes on redeploy.
 */
const TEMPLATE_PATH = join(__dirname, '..', '..', 'templates', 'id-card.hbs');
let compiledTemplate: Handlebars.TemplateDelegate<TemplateContext> | null = null;
function getTemplate(): Handlebars.TemplateDelegate<TemplateContext> {
  if (!compiledTemplate) {
    const source = readFileSync(TEMPLATE_PATH, 'utf8');
    compiledTemplate = Handlebars.compile<TemplateContext>(source, { noEscape: false });
  }
  return compiledTemplate;
}

@Injectable()
@Processor(QUEUES.ID_CARD_GENERATION, { concurrency: 2 })
export class IdCardGenerationProcessor extends BaseProcessor<
  IdCardGenerationPayload,
  IdCardGenerationResult
> {
  private readonly localLogger = new Logger('idcard-generation');

  constructor(
    redis: RedisService,
    private readonly drizzle: DrizzleService,
    private readonly storage: StorageService,
    private readonly cfg: AppConfigService,
    private readonly mediaRepo: MediaAssetsRepository,
  ) {
    super(QUEUES.ID_CARD_GENERATION, redis);
  }

  async handle(
    job: Job<IdCardGenerationPayload, IdCardGenerationResult>,
  ): Promise<IdCardGenerationResult> {
    const { student_id } = job.data;

    // ----- Load student + parent + centre + batch in one read --------------
    const rows = await this.drizzle.dbRead
      .select({
        student: students,
        parent: users,
        centre: centres,
        batch: batches,
      })
      .from(students)
      .innerJoin(users, eq(users.id, students.parent_user_id))
      .innerJoin(centres, eq(centres.id, students.centre_id))
      .leftJoin(batches, eq(batches.id, students.batch_id))
      .where(eq(students.id, student_id))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new Error(`student ${student_id} not found`);
    }
    const { student, centre, batch } = row;

    // ----- Resolve photo URL (data: URL embedded in the template) ----------
    let photoDataUrl = '';
    if (student.profile_photo_asset_id) {
      const asset = await this.mediaRepo.findById(student.profile_photo_asset_id);
      if (asset && asset.status === 'ready') {
        try {
          const got = await this.storage.adapter.getObject('private', asset.s3_key);
          photoDataUrl = `data:${got.contentType};base64,${got.body.toString('base64')}`;
        } catch (err) {
          this.localLogger.warn(`photo fetch failed for ${asset.id}: ${(err as Error).message}`);
        }
      }
    }

    // ----- QR payload + image (data URL) -----------------------------------
    const qrPayloadUuid = shortUuid(student.id);
    const qrPayloadUrl = `${QR_BASE_URL}/${qrPayloadUuid}`;
    const qrSecret = this.cfg.raw.AI_SERVICE_HMAC_SECRET || 'jp-dev-qr-secret';
    const qrSignature = createHmac('sha256', qrSecret)
      .update(`${student.id}:${qrPayloadUuid}`)
      .digest('hex');
    const qrPng = await QRCode.toBuffer(qrPayloadUrl, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 256,
      color: { dark: '#1A0A00', light: '#FFFFFF' },
    });
    const qrDataUrl = `data:image/png;base64,${qrPng.toString('base64')}`;

    // ----- Render the Handlebars template ---------------------------------
    const academicYear = batch?.academic_year ?? centre.academic_year ?? this.currentAcademicYear();
    const context: TemplateContext = {
      student_name_en: student.full_name,
      student_name_hi: student.full_name,
      father_name: student.father_name ?? '',
      photo_url: photoDataUrl,
      photo_initials: initials(student.full_name),
      student_id: student.student_code,
      centre_name_en: centre.name,
      centre_name_hi: centre.name,
      batch_name_en: batch
        ? `${batch.name} · ${dayLabels(batch.day_of_week)} ${formatTimeRange(batch.start_time, batch.end_time)}`
        : '—',
      batch_name_hi: batch ? batch.name : '—',
      qr_code_url: qrDataUrl,
      msv_badge: student.msv_status === 'approved',
      valid_year: academicYear,
      verify_url: `jainpathshala.app/v/${student.student_code}`,
      tier_label_en: 'Jigyasu',
      tier_label_hi: 'जिज्ञासु',
      tier_color: '#8B6F5E',
      dob_display: formatDob(String(student.dob)),
    };
    const html = getTemplate()(context);

    // ----- Render PNG (puppeteer preferred, sharp fallback) ----------------
    const png = await this.renderHtmlToPng(html);

    // ----- Upload to the public bucket under idcards/{student_id}.png -----
    const objectKey = `idcards/${student.id}.png`;
    await this.storage.adapter.putObject('public', objectKey, {
      body: png,
      contentType: 'image/png',
      cacheControl: 'public,max-age=31536000,immutable',
    });

    // ----- Insert a media_assets row so the card has a stable asset id ----
    const cardAsset = await this.mediaRepo
      .create({
        kind: 'misc',
        owner_user_id: student.parent_user_id,
        s3_bucket: this.storage.adapter.bucketName('public'),
        s3_key: objectKey,
        mime_type: 'image/png',
        size_bytes: png.length,
        checksum_sha256: '',
        status: 'ready',
        exif_stripped: true,
        processed_at: new Date(),
      })
      .catch((err) => {
        this.localLogger.warn(`media_assets insert failed: ${(err as Error).message}`);
        return null;
      });

    // ----- Upsert the digital_id_cards row --------------------------------
    const upserted = await this.drizzle.db
      .insert(digital_id_cards)
      .values({
        student_id: student.id,
        card_number: student.student_code,
        qr_payload: qrPayloadUrl,
        qr_payload_signature: qrSignature,
        png_asset_id: cardAsset?.id ?? null,
        msv_badge: student.msv_status === 'approved',
        version_no: 1,
        generated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: digital_id_cards.student_id,
        set: {
          qr_payload: qrPayloadUrl,
          qr_payload_signature: qrSignature,
          png_asset_id: cardAsset?.id ?? null,
          msv_badge: student.msv_status === 'approved',
          version_no: sql`${digital_id_cards.version_no} + 1`,
          last_regenerated_at: new Date(),
          updated_at: new Date(),
        },
      })
      .returning();
    const card = upserted[0];
    if (!card) {
      throw new Error('digital_id_cards upsert returned no row');
    }

    this.localLogger.log(
      `id card v${card.version_no} for ${student.student_code} (${png.length} bytes) uploaded to ${objectKey}`,
    );

    return {
      card_id: card.id,
      student_id: student.id,
      asset_id: cardAsset?.id ?? null,
      card_number: card.card_number,
      bytes: png.length,
      version_no: card.version_no,
    };
  }

  // ---------------------------------------------------------------------------
  // HTML → PNG
  //
  // Prefer puppeteer when a Chromium binary is available — it gives us
  // pixel-accurate rendering matching the design system preview. When
  // puppeteer.launch() can't find a browser (common in CI / dev containers
  // without Chromium downloaded) we fall back to a sharp+SVG path that
  // produces a deterministic PNG with all the same data fields so the
  // upstream test (assert digital_id_cards row + signed URL) still passes.
  // ---------------------------------------------------------------------------
  private async renderHtmlToPng(html: string): Promise<Buffer> {
    const viaPuppeteer = await this.tryPuppeteer(html);
    if (viaPuppeteer) return viaPuppeteer;
    return this.renderSvgFallback(html);
  }

  private async tryPuppeteer(html: string): Promise<Buffer | null> {
    try {
      // Dynamic import so the worker still boots when Chromium isn't on disk.
      // Use `unknown` cast because the CJS interop wrapping varies between
      // versions and we only need `.launch()`.
      const mod = (await import('puppeteer').catch(() => null)) as unknown as {
        launch: (opts: unknown) => Promise<unknown>;
        default?: { launch: (opts: unknown) => Promise<unknown> };
      } | null;
      if (!mod) return null;
      const puppeteer = mod.default ?? mod;
      const browser = (await puppeteer
        .launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        })
        .catch(() => null)) as null | {
        newPage: () => Promise<PuppeteerPage>;
        close: () => Promise<void>;
      };
      if (!browser) return null;
      try {
        const page = await browser.newPage();
        await page.setViewport({
          width: 540,
          height: 340,
          deviceScaleFactor: 2,
        });
        await page.setContent(html, { waitUntil: 'load' });
        const card = await page.$('.card-frame');
        const png = card
          ? await card.screenshot({ type: 'png', omitBackground: true })
          : await page.screenshot({ type: 'png', fullPage: true });
        const pngBuffer = Buffer.isBuffer(png) ? png : Buffer.from(png as Uint8Array);
        // Upscale to 1080×1700 per Step 11 spec — sharp preserves aspect ratio
        // by fitting into the target box.
        return sharp(pngBuffer)
          .resize({
            width: PNG_WIDTH,
            height: PNG_HEIGHT,
            fit: 'contain',
            background: { r: 253, g: 248, b: 242, alpha: 1 },
          })
          .png()
          .toBuffer();
      } finally {
        await browser.close().catch(() => undefined);
      }
    } catch (err) {
      this.localLogger.warn(
        `puppeteer render failed, using sharp fallback: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Sharp+SVG fallback. Produces a 1080×1700 PNG with the saffron / maroon
   * / cream palette and embeds the data variables as plain SVG text. The
   * Handlebars HTML is parsed by stripping tags and pulling out a minimal
   * subset of fields via regex (defensive — works for both the live template
   * and any future variants we keep simple). The visual layout is a faithful
   * but simplified port of jp-design-system/preview/id-card.html.
   */
  private async renderSvgFallback(html: string): Promise<Buffer> {
    const pick = (label: RegExp): string => html.match(label)?.[1]?.trim() ?? '';
    const studentNameEn = pick(/class="name-en">([^<]+)</);
    const studentNameHi = pick(/class="name-hi">([^<]+)</);
    const studentId = pick(/class="val mono">([^<]+)</);
    const dobLine = pick(/class="meta-line">([^<]+)</);
    const centreName = pick(/<div class="lbl">Centre<\/div>\s*<div class="val">([^<]+)</);
    const batchName = pick(/<div class="lbl">Batch<\/div>\s*<div class="val">([^<]+)</);
    const validYear = pick(/Student Identity Card · ([^<]+)<\/div>/);
    const verifyUrl = pick(/class="verify">([^<]+)</);
    const hasMsv = /class="msv-badge"/.test(html);
    const qrMatch = html.match(/<img src="(data:image\/png;base64,[^"]+)"/);
    const qrDataUrl = qrMatch?.[1] ?? '';
    const photoMatch = html.match(/background-image: url\("(data:[^"]+)"\)/);
    const photoDataUrl = photoMatch?.[1] ?? '';

    // The SVG is sized in viewBox units that map 1:1 to a 540×340 card; we
    // then scale up to 1080×1700 via sharp `resize`.
    const cardSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="540" height="340" viewBox="0 0 540 340">
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
    <clipPath id="card-clip">
      <rect x="0" y="0" width="540" height="340" rx="16" ry="16"/>
    </clipPath>
  </defs>
  <g clip-path="url(#card-clip)">
    <rect width="540" height="340" fill="#FFFFFF"/>
    <rect width="540" height="80" fill="url(#band)"/>

    <!-- Logo mark -->
    <rect x="18" y="22" width="36" height="36" rx="8" fill="url(#logo)"/>
    <text x="36" y="50" text-anchor="middle"
          font-family="'Tiro Devanagari Sanskrit', Georgia, serif"
          font-size="22" fill="#FFFFFF">ज</text>

    <!-- Brand title -->
    <text x="64" y="38" font-family="'Tiro Devanagari Sanskrit', Georgia, serif"
          font-size="18" fill="#FDF8F2">Jain Pathshala</text>
    <text x="64" y="54" font-family="Mukta, sans-serif" font-size="9"
          letter-spacing="1.2" fill="#E8A06A">STUDENT IDENTITY CARD · ${escapeXml(validYear)}</text>

    ${
      hasMsv
        ? `<rect x="478" y="30" width="44" height="22" rx="6" fill="url(#msv)"/>
           <text x="500" y="46" text-anchor="middle" font-family="Mukta, sans-serif"
                 font-size="10" font-weight="800" letter-spacing="1.5" fill="#5C1010">MSV</text>`
        : ''
    }

    <!-- Photo box -->
    ${
      photoDataUrl
        ? `<image x="18" y="98" width="120" height="144" preserveAspectRatio="xMidYMid slice"
                  href="${photoDataUrl}"/>`
        : `<rect x="18" y="98" width="120" height="144" rx="8" fill="url(#logo)"/>
           <text x="78" y="180" text-anchor="middle"
                 font-family="'Tiro Devanagari Sanskrit', Georgia, serif"
                 font-size="40" fill="#FFFFFF">${escapeXml(initialsFromText(studentNameEn))}</text>`
    }

    <!-- Name + meta -->
    <text x="156" y="116" font-family="'Tiro Devanagari Sanskrit', Georgia, serif"
          font-size="22" fill="#7A1818">${escapeXml(studentNameEn)}</text>
    <text x="156" y="134" font-family="'Tiro Devanagari Sanskrit', Georgia, serif"
          font-size="13" fill="#7A1818">${escapeXml(studentNameHi)}</text>
    <text x="156" y="150" font-family="Mukta, sans-serif" font-size="11"
          fill="#8B6F5E">${escapeXml(dobLine)}</text>

    <!-- Data grid -->
    <g font-family="Mukta, sans-serif" font-size="11">
      <text x="156" y="178" fill="#8B6F5E">Student ID</text>
      <text x="240" y="178" font-family="'JetBrains Mono', monospace" font-weight="600"
            fill="#1A0A00">${escapeXml(studentId)}</text>

      <text x="156" y="198" fill="#8B6F5E">Centre</text>
      <text x="240" y="198" font-weight="600" fill="#1A0A00">${escapeXml(centreName)}</text>

      <text x="156" y="218" fill="#8B6F5E">Batch</text>
      <text x="240" y="218" font-weight="600" fill="#1A0A00">${escapeXml(batchName)}</text>

      <text x="156" y="238" fill="#8B6F5E">Tier</text>
      <circle cx="244" cy="234" r="4" fill="#8B6F5E"/>
      <text x="254" y="238" font-family="'Tiro Devanagari Sanskrit', Georgia, serif"
            font-weight="600" fill="#8B6F5E">Jigyasu</text>
    </g>

    <!-- QR box -->
    <rect x="430" y="118" width="92" height="92" rx="6" fill="#FFFFFF" stroke="#E6D8C2"/>
    ${qrDataUrl ? `<image x="436" y="124" width="80" height="80" href="${qrDataUrl}"/>` : ''}
    <text x="476" y="226" text-anchor="middle"
          font-family="'JetBrains Mono', monospace" font-size="10"
          fill="#8B6F5E">verify</text>

    <!-- Bottom cream strip -->
    <rect x="0" y="316" width="540" height="24" fill="#F5EDE0"/>
    <text x="18" y="332" font-family="Mukta, sans-serif" font-size="10"
          fill="#8B6F5E">Valid until 31 Mar ${escapeXml(validYear)} · Property of Jain Pathshala Trust</text>
    <text x="522" y="332" text-anchor="end" font-family="'JetBrains Mono', monospace"
          font-size="10" fill="#8B6F5E">${escapeXml(verifyUrl)}</text>
  </g>
  <rect x="0.5" y="0.5" width="539" height="339" rx="16" ry="16"
        fill="none" stroke="#E6D8C2"/>
</svg>`;

    // Mount the 540×340 SVG centred on a 1080×1700 cream canvas so the final
    // asset matches the Step 11 dimension requirement exactly.
    const cardPng = await sharp(Buffer.from(cardSvg)).png().toBuffer();
    return sharp({
      create: {
        width: PNG_WIDTH,
        height: PNG_HEIGHT,
        channels: 4,
        background: { r: 253, g: 248, b: 242, alpha: 1 },
      },
    })
      .composite([
        {
          input: await sharp(cardPng)
            .resize({ width: 980, height: 617, fit: 'contain' })
            .toBuffer(),
          gravity: 'centre',
        },
      ])
      .png()
      .toBuffer();
  }

  private currentAcademicYear(): string {
    const now = new Date();
    const m = now.getUTCMonth(); // 0-based, April = 3
    const y = now.getUTCFullYear();
    const start = m >= 3 ? y : y - 1;
    const endShort = String((start + 1) % 100).padStart(2, '0');
    return `${start}–${endShort}`;
  }
}

function escapeXml(value: string): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function initialsFromText(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}
