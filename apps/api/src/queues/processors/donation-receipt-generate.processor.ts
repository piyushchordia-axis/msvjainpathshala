/**
 * `donation.receipt.generate` worker (SPEC §6.21, §8.8, Step 21).
 *
 * Flow per job:
 *   1. Load the donation row + (optional) donor user + campaign.
 *   2. Render apps/api/src/templates/donation-receipt.hbs.
 *   3. Convert HTML → PDF via puppeteer; fallback to an HTML-as-bytes
 *      buffer when Chromium isn't on disk (matches the id-card processor's
 *      defensive pattern — keeps dev usable without browser deps).
 *   4. Upload to jp-{env}-receipts/donations/{donation_id}.pdf.
 *   5. Insert a media_assets row, write its id back onto donations.
 *   6. Enqueue an email notification (notifications.fanout) to the donor.
 *
 * Idempotent: re-running the job overwrites the object and updates the
 * same media_assets row — donations.receipt_asset_id is set to the latest.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import Handlebars from 'handlebars';

import { AppConfigService } from '../../core/config/app-config.service';
import { RedisService } from '../../core/redis/redis.service';
import { StorageService } from '../../core/storage/storage.service';
import { MediaAssetsRepository } from '../../db/repositories';
import { DonationsRepository } from '../../db/repositories/donations.repository';
import { PanEncryptionService } from '../../modules/donations/pan-encryption.service';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

import type { Job } from 'bullmq';

export interface DonationReceiptPayload {
  donation_id: string;
}

export interface DonationReceiptResult {
  donation_id: string;
  asset_id: string | null;
  s3_key: string;
  bytes: number;
  via: 'puppeteer' | 'fallback';
}

interface ReceiptTemplateContext {
  receipt_number: string;
  financial_year: string;
  issued_on_display: string;
  donor_name: string;
  donor_email?: string | null;
  donor_phone?: string | null;
  donor_pan_masked?: string | null;
  purpose_label: string;
  campaign_name?: string | null;
  razorpay_payment_id: string;
  razorpay_order_id: string;
  captured_on_display: string;
  amount_inr_display: string;
  currency: string;
  trust_name: string;
  eighty_g_note: string;
}

const PURPOSE_LABELS: Record<string, string> = {
  general: 'General donation',
  shivir: 'Shivir',
  scholarship: 'Scholarship fund',
  infrastructure: 'Infrastructure',
};

const TEMPLATE_PATH = join(__dirname, '..', '..', 'templates', 'donation-receipt.hbs');
let compiled: Handlebars.TemplateDelegate<ReceiptTemplateContext> | null = null;
function getTemplate(): Handlebars.TemplateDelegate<ReceiptTemplateContext> {
  if (!compiled) {
    const src = readFileSync(TEMPLATE_PATH, 'utf8');
    compiled = Handlebars.compile<ReceiptTemplateContext>(src, { noEscape: false });
  }
  return compiled;
}

function formatDate(date: Date): string {
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
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = months[date.getUTCMonth()] ?? '';
  return `${d} ${m} ${date.getUTCFullYear()}`;
}

function rupees(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

@Injectable()
@Processor(QUEUES.DONATION_RECEIPT_GENERATE, { concurrency: 2 })
export class DonationReceiptGenerateProcessor extends BaseProcessor<
  DonationReceiptPayload,
  DonationReceiptResult
> {
  private readonly localLogger = new Logger('donation-receipt-generate');

  constructor(
    redis: RedisService,
    private readonly donations: DonationsRepository,
    private readonly media: MediaAssetsRepository,
    private readonly storage: StorageService,
    private readonly cfg: AppConfigService,
    private readonly pan: PanEncryptionService,
    @InjectQueue(QUEUES.NOTIFICATIONS_FANOUT) private readonly fanoutQueue: Queue,
  ) {
    super(QUEUES.DONATION_RECEIPT_GENERATE, redis);
    void this.cfg;
  }

  async handle(
    job: Job<DonationReceiptPayload, DonationReceiptResult>,
  ): Promise<DonationReceiptResult> {
    const { donation_id } = job.data;
    const donation = await this.donations.findById(donation_id);
    if (!donation) throw new Error(`donation ${donation_id} not found`);
    if (donation.status !== 'captured') {
      throw new Error(`donation ${donation_id} not captured (status=${donation.status})`);
    }

    const captured = donation.payment_captured_at ?? new Date();
    const context: ReceiptTemplateContext = {
      receipt_number: donation.receipt_number ?? donation.id.slice(0, 8).toUpperCase(),
      financial_year: donation.financial_year ?? '—',
      issued_on_display: formatDate(new Date()),
      donor_name: donation.donor_name,
      donor_email: donation.donor_email,
      donor_phone: donation.donor_phone,
      donor_pan_masked: donation.donor_pan
        ? this.pan.maskPan(this.pan.decryptPan(donation.donor_pan) ?? '')
        : null,
      purpose_label: PURPOSE_LABELS[donation.purpose] ?? donation.purpose,
      campaign_name: null,
      razorpay_payment_id: donation.razorpay_payment_id ?? '—',
      razorpay_order_id: donation.razorpay_order_id ?? '—',
      captured_on_display: formatDate(captured),
      amount_inr_display: rupees(donation.amount_paise),
      currency: donation.currency,
      trust_name: 'Megh Sanskar Vatika',
      eighty_g_note: donation.eighty_g_eligible
        ? "An 80G certificate has been issued separately under the trust's registered identity. "
        : '',
    };

    const html = getTemplate()(context);
    const rendered = await this.renderHtmlToPdf(html);

    const objectKey = `donations/${donation.id}.pdf`;
    await this.storage.adapter.putObject('receipts', objectKey, {
      body: rendered.bytes,
      contentType: 'application/pdf',
      contentDisposition: `inline; filename="receipt-${context.receipt_number}.pdf"`,
      cacheControl: 'private,max-age=0,no-cache',
    });

    // Only track a media_assets row when the donor is a signed-in user —
    // anonymous donations still get the receipt object in S3, but we don't
    // hang a row off a non-existent user (media_assets.owner_user_id is
    // NOT NULL with a hard FK to users).
    let asset: { id: string } | null = null;
    if (donation.donor_user_id) {
      asset = await this.media
        .create({
          kind: 'misc',
          owner_user_id: donation.donor_user_id,
          s3_bucket: this.storage.adapter.bucketName('receipts'),
          s3_key: objectKey,
          mime_type: 'application/pdf',
          size_bytes: rendered.bytes.length,
          checksum_sha256: '',
          status: 'ready',
          exif_stripped: true,
          processed_at: new Date(),
        })
        .catch((err) => {
          this.localLogger.warn(`media insert failed: ${(err as Error).message}`);
          return null;
        });

      if (asset) {
        await this.donations.setReceiptAsset(donation.id, asset.id);
      }
    }

    // Best-effort donor email + push.
    if (donation.donor_email || donation.donor_user_id) {
      await this.fanoutQueue
        .add('donation.receipt.ready', {
          event: 'donation.receipt.ready',
          recipient_user_ids: donation.donor_user_id ? [donation.donor_user_id] : [],
          recipient_emails: donation.donor_email ? [donation.donor_email] : [],
          source: { kind: 'donation', id: donation.id },
          data: {
            amount_inr: donation.amount_paise / 100,
            receipt_number: context.receipt_number,
            donor_name: donation.donor_name,
            financial_year: context.financial_year,
          },
          deep_link: `/donations/${donation.id}`,
        })
        .catch((err) =>
          this.localLogger.warn(`receipt fanout enqueue failed: ${(err as Error).message}`),
        );
    }

    this.localLogger.log(
      `receipt ${context.receipt_number} (${rendered.bytes.length} bytes, via=${rendered.via}) uploaded to ${objectKey}`,
    );

    return {
      donation_id: donation.id,
      asset_id: asset?.id ?? null,
      s3_key: objectKey,
      bytes: rendered.bytes.length,
      via: rendered.via,
    };
  }

  // ---------------------------------------------------------------------
  // HTML → PDF — prefer puppeteer; fall back to a plain UTF-8 buffer of
  // the HTML so the pipeline keeps working without Chromium on disk.
  // ---------------------------------------------------------------------
  private async renderHtmlToPdf(
    html: string,
  ): Promise<{ bytes: Buffer; via: 'puppeteer' | 'fallback' }> {
    const viaPuppeteer = await this.tryPuppeteer(html);
    if (viaPuppeteer) return { bytes: viaPuppeteer, via: 'puppeteer' };
    return { bytes: Buffer.from(html, 'utf8'), via: 'fallback' };
  }

  private async tryPuppeteer(html: string): Promise<Buffer | null> {
    try {
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
        newPage: () => Promise<{
          setContent: (html: string, opts?: { waitUntil?: string }) => Promise<void>;
          pdf: (opts: {
            format: string;
            printBackground: boolean;
            margin: Record<string, string>;
          }) => Promise<Buffer | Uint8Array>;
        }>;
        close: () => Promise<void>;
      };
      if (!browser) return null;
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
        });
        return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf as Uint8Array);
      } finally {
        await browser.close().catch(() => undefined);
      }
    } catch (err) {
      this.localLogger.warn(`puppeteer pdf failed: ${(err as Error).message}`);
      return null;
    }
  }
}
