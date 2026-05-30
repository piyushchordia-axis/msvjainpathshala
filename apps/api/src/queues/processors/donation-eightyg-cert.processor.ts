/**
 * `donation.eightyg.cert` worker (CLAUDE.md Q3, SPEC §8.8, Step 21).
 *
 * Generates the 80G certificate PDF for a single donation via PdfService.
 */

import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { formatInrFromPaise, formatPdfDate } from '../../core/pdf/pdf-format';
import { PdfService } from '../../core/pdf/pdf.service';
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

const PURPOSE_LABELS: Record<string, string> = {
  general: 'General donation',
  shivir: 'Shivir',
  scholarship: 'Scholarship fund',
  infrastructure: 'Infrastructure',
};

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
    private readonly pdf: PdfService,
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
    const receiptNumber = donation.receipt_number ?? donation.id.slice(0, 8).toUpperCase();
    const financialYear = donation.financial_year ?? '—';

    const pdfBytes = await this.pdf.renderEightyGCert({
      receiptNumber,
      financialYear,
      issuedOnDisplay: formatPdfDate(new Date()),
      donorName: donation.donor_name,
      donorPanMasked: decryptedPan ? this.pan.maskPan(decryptedPan) : null,
      purposeLabel: PURPOSE_LABELS[donation.purpose] ?? donation.purpose,
      razorpayPaymentId: donation.razorpay_payment_id ?? '—',
      capturedOnDisplay: formatPdfDate(captured),
      amountInrDisplay: formatInrFromPaise(donation.amount_paise),
      currency: donation.currency,
      trustName: settings.eighty_g_trust_name,
      trustAddress: settings.eighty_g_trust_address,
      trustPan: settings.eighty_g_registration_number,
      registrationNumber: settings.eighty_g_registration_number,
      section: settings.eighty_g_section ?? '80G',
    });

    const objectKey = `80g/${donation.id}.pdf`;
    await this.storage.adapter.putObject('receipts', objectKey, {
      body: pdfBytes,
      contentType: 'application/pdf',
      contentDisposition: `inline; filename="80G-${receiptNumber}.pdf"`,
      cacheControl: 'private,max-age=0,no-cache',
    });

    let asset: { id: string } | null = null;
    if (donation.donor_user_id) {
      asset = await this.media
        .create({
          kind: 'misc',
          owner_user_id: donation.donor_user_id,
          s3_bucket: this.storage.adapter.bucketName('receipts'),
          s3_key: objectKey,
          mime_type: 'application/pdf',
          size_bytes: pdfBytes.length,
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
            certificate_number: receiptNumber,
            financial_year: financialYear,
          },
          deep_link: `/donations/${donation.id}`,
        })
        .catch((err) =>
          this.localLogger.warn(`80G fanout enqueue failed: ${(err as Error).message}`),
        );
    }

    this.localLogger.log(
      `80G cert ${receiptNumber} (${pdfBytes.length} bytes, via=pdfkit) uploaded to ${objectKey}`,
    );

    return {
      donation_id: donation.id,
      asset_id: asset?.id ?? null,
      s3_key: objectKey,
      bytes: pdfBytes.length,
      status: 'generated',
    };
  }
}
