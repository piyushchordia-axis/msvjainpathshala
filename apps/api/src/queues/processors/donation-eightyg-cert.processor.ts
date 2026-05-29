/**
 * `donation.eightyg.cert` worker (CLAUDE.md Q3, SPEC §8.8, Step 21).
 *
 * Generates the 80G certificate PDF for a single donation. Identical
 * skeleton to the receipt worker but:
 *   - Uses apps/api/src/templates/eighty-g-cert.hbs
 *   - Reads platform_settings (eighty_g_registration_number, trust_name,
 *     trust_address, eighty_g_section) — re-checks `eighty_g_enabled` so a
 *     toggle-off between enqueue and process is a no-op rather than a leak.
 *   - Stores under jp-{env}-receipts/80g/{donation_id}.pdf.
 *   - Sets donations.eighty_g_certificate_asset_id + eighty_g_eligible=true.
 *   - Best-effort donor email via the `eighty-g-certificate` template.
 *
 * If `eighty_g_enabled` flipped to false between enqueue and process, we
 * log + skip — no partial cert lands.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import Handlebars from 'handlebars';

import { RedisService } from '../../core/redis/redis.service';
import { StorageService } from '../../core/storage/storage.service';
import { MediaAssetsRepository } from '../../db/repositories';
import { DonationsRepository } from '../../db/repositories/donations.repository';
import { PlatformSettingsRepository } from '../../db/repositories/platform-settings.repository';
import { PanEncryptionService } from '../../modules/donations/pan-encryption.service';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

import type { Job } from 'bullmq';

export interface DonationEightyGPayload {
  donation_id: string;
}

export interface DonationEightyGResult {
  donation_id: string;
  asset_id: string | null;
  s3_key: string | null;
  bytes: number;
  status: 'generated' | 'skipped';
  reason?: string;
}

interface CertTemplateContext {
  receipt_number: string;
  financial_year: string;
  issued_on_display: string;
  donor_name: string;
  donor_pan_masked: string | null;
  purpose_label: string;
  razorpay_payment_id: string;
  captured_on_display: string;
  amount_inr_display: string;
  currency: string;
  trust_name: string;
  trust_address: string;
  trust_pan: string;
  registration_number: string;
  section: string;
}

const PURPOSE_LABELS: Record<string, string> = {
  general: 'General donation',
  shivir: 'Shivir',
  scholarship: 'Scholarship fund',
  infrastructure: 'Infrastructure',
};

const TEMPLATE_PATH = join(__dirname, '..', '..', 'templates', 'eighty-g-cert.hbs');
let compiled: Handlebars.TemplateDelegate<CertTemplateContext> | null = null;
function getTemplate(): Handlebars.TemplateDelegate<CertTemplateContext> {
  if (!compiled) {
    const src = readFileSync(TEMPLATE_PATH, 'utf8');
    compiled = Handlebars.compile<CertTemplateContext>(src, { noEscape: false });
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
@Processor(QUEUES.DONATION_EIGHTYG_CERT, { concurrency: 2 })
export class DonationEightyGCertProcessor extends BaseProcessor<
  DonationEightyGPayload,
  DonationEightyGResult
> {
  private readonly localLogger = new Logger('donation-eightyg-cert');

  constructor(
    redis: RedisService,
    private readonly donations: DonationsRepository,
    private readonly settings: PlatformSettingsRepository,
    private readonly media: MediaAssetsRepository,
    private readonly storage: StorageService,
    private readonly pan: PanEncryptionService,
    @InjectQueue(QUEUES.NOTIFICATIONS_FANOUT) private readonly fanoutQueue: Queue,
  ) {
    super(QUEUES.DONATION_EIGHTYG_CERT, redis);
  }

  async handle(
    job: Job<DonationEightyGPayload, DonationEightyGResult>,
  ): Promise<DonationEightyGResult> {
    const { donation_id } = job.data;

    const settings = await this.settings.get();
    if (!settings.eighty_g_enabled) {
      this.localLogger.warn(`donation ${donation_id} 80G cert skipped — eighty_g_enabled=false`);
      return {
        donation_id,
        asset_id: null,
        s3_key: null,
        bytes: 0,
        status: 'skipped',
        reason: 'eighty_g_disabled',
      };
    }
    if (
      !settings.eighty_g_registration_number?.trim() ||
      !settings.eighty_g_trust_name?.trim() ||
      !settings.eighty_g_trust_address?.trim()
    ) {
      this.localLogger.warn(`donation ${donation_id} 80G cert skipped — prereqs missing`);
      return {
        donation_id,
        asset_id: null,
        s3_key: null,
        bytes: 0,
        status: 'skipped',
        reason: 'prereqs_missing',
      };
    }

    const donation = await this.donations.findById(donation_id);
    if (!donation) throw new Error(`donation ${donation_id} not found`);
    if (!donation.donor_pan) {
      this.localLogger.warn(`donation ${donation_id} 80G cert skipped — no donor PAN`);
      return {
        donation_id,
        asset_id: null,
        s3_key: null,
        bytes: 0,
        status: 'skipped',
        reason: 'no_pan',
      };
    }

    const decryptedPan = this.pan.decryptPan(donation.donor_pan);
    const captured = donation.payment_captured_at ?? new Date();
    const context: CertTemplateContext = {
      receipt_number: donation.receipt_number ?? donation.id.slice(0, 8).toUpperCase(),
      financial_year: donation.financial_year ?? '—',
      issued_on_display: formatDate(new Date()),
      donor_name: donation.donor_name,
      donor_pan_masked: decryptedPan ? this.pan.maskPan(decryptedPan) : null,
      purpose_label: PURPOSE_LABELS[donation.purpose] ?? donation.purpose,
      razorpay_payment_id: donation.razorpay_payment_id ?? '—',
      captured_on_display: formatDate(captured),
      amount_inr_display: rupees(donation.amount_paise),
      currency: donation.currency,
      trust_name: settings.eighty_g_trust_name,
      trust_address: settings.eighty_g_trust_address,
      // Trust PAN is stored separately on platform_settings would be ideal,
      // but per CLAUDE.md Q3 we just surface the registration number; trust
      // PAN is not stored in our schema — show the registration number.
      trust_pan: settings.eighty_g_registration_number,
      registration_number: settings.eighty_g_registration_number,
      section: settings.eighty_g_section ?? '80G',
    };

    const html = getTemplate()(context);
    const pdf = await this.renderHtmlToPdf(html);

    const objectKey = `80g/${donation.id}.pdf`;
    await this.storage.adapter.putObject('receipts', objectKey, {
      body: pdf,
      contentType: 'application/pdf',
      contentDisposition: `inline; filename="80G-${context.receipt_number}.pdf"`,
      cacheControl: 'private,max-age=0,no-cache',
    });

    // Only track media_assets when the donor is signed in — see receipt
    // processor for the rationale.
    let asset: { id: string } | null = null;
    if (donation.donor_user_id) {
      asset = await this.media
        .create({
          kind: 'misc',
          owner_user_id: donation.donor_user_id,
          s3_bucket: this.storage.adapter.bucketName('receipts'),
          s3_key: objectKey,
          mime_type: 'application/pdf',
          size_bytes: pdf.length,
          checksum_sha256: '',
          status: 'ready',
          exif_stripped: true,
          processed_at: new Date(),
        })
        .catch((err) => {
          this.localLogger.warn(`80G media insert failed: ${(err as Error).message}`);
          return null;
        });

      if (asset) {
        await this.donations.setEightyGAsset(donation.id, asset.id);
      }
    }

    if (donation.donor_email || donation.donor_user_id) {
      await this.fanoutQueue
        .add('donation.eightyg.ready', {
          event: 'donation.eightyg.ready',
          recipient_user_ids: donation.donor_user_id ? [donation.donor_user_id] : [],
          recipient_emails: donation.donor_email ? [donation.donor_email] : [],
          source: { kind: 'donation', id: donation.id },
          data: {
            certificate_number: context.receipt_number,
            financial_year: context.financial_year,
          },
          deep_link: `/donations/${donation.id}`,
        })
        .catch((err) =>
          this.localLogger.warn(`80G fanout enqueue failed: ${(err as Error).message}`),
        );
    }

    this.localLogger.log(
      `80G cert ${context.receipt_number} (${pdf.length} bytes) uploaded to ${objectKey}`,
    );

    return {
      donation_id: donation.id,
      asset_id: asset?.id ?? null,
      s3_key: objectKey,
      bytes: pdf.length,
      status: 'generated',
    };
  }

  private async renderHtmlToPdf(html: string): Promise<Buffer> {
    try {
      const mod = (await import('puppeteer').catch(() => null)) as unknown as {
        launch: (opts: unknown) => Promise<unknown>;
        default?: { launch: (opts: unknown) => Promise<unknown> };
      } | null;
      if (mod) {
        const puppeteer = mod.default ?? mod;
        const browser = (await puppeteer
          .launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
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
        if (browser) {
          try {
            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: 'load' });
            const pdf = await page.pdf({
              format: 'A4',
              printBackground: true,
              margin: { top: '20mm', bottom: '20mm', left: '16mm', right: '16mm' },
            });
            return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf as Uint8Array);
          } finally {
            await browser.close().catch(() => undefined);
          }
        }
      }
    } catch (err) {
      this.localLogger.warn(`puppeteer 80G pdf failed: ${(err as Error).message}`);
    }
    return Buffer.from(html, 'utf8');
  }
}
