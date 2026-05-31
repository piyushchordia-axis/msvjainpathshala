/**
 * `donation.receipt.generate` worker (SPEC §6.21, §8.8, Step 21).
 *
 * Flow per job:
 *   1. Load the donation row.
 *   2. Render PDF via PdfService (pdfkit).
 *   3. Upload to jp-{env}-receipts/donations/{donation_id}.pdf.
 *   4. Insert media_assets when donor is a signed-in user.
 *   5. Enqueue donor notification (notifications.fanout).
 */

import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AppConfigService } from '../../core/config/app-config.service';
import { formatInrFromPaise, formatPdfDate } from '../../core/pdf/pdf-format';
import { PdfService } from '../../core/pdf/pdf.service';
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
  via: 'pdfkit';
}

const PURPOSE_LABELS: Record<string, string> = {
  general: 'General donation',
  shivir: 'Shivir',
  scholarship: 'Scholarship fund',
  infrastructure: 'Infrastructure',
};

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
    private readonly pdf: PdfService,
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
    const receiptNumber = donation.receipt_number ?? donation.id.slice(0, 8).toUpperCase();
    const financialYear = donation.financial_year ?? '—';

    const pdfBytes = await this.pdf.renderDonationReceipt({
      receiptNumber,
      financialYear,
      issuedOnDisplay: formatPdfDate(new Date()),
      donorName: donation.donor_name,
      donorEmail: donation.donor_email,
      donorPhone: donation.donor_phone,
      donorPanMasked: donation.donor_pan
        ? this.pan.maskPan(this.pan.decryptPan(donation.donor_pan) ?? '')
        : null,
      purposeLabel: PURPOSE_LABELS[donation.purpose] ?? donation.purpose,
      campaignName: null,
      razorpayPaymentId: donation.razorpay_payment_id ?? '—',
      razorpayOrderId: donation.razorpay_order_id ?? '—',
      capturedOnDisplay: formatPdfDate(captured),
      amountInrDisplay: formatInrFromPaise(donation.amount_paise),
      currency: donation.currency,
      trustName: 'Megh Sanskar Vatika',
      eightyGNote: donation.eighty_g_eligible
        ? "An 80G certificate has been issued separately under the trust's registered identity. "
        : '',
    });

    const objectKey = `donations/${donation.id}.pdf`;
    await this.storage.adapter.putObject('receipts', objectKey, {
      body: pdfBytes,
      contentType: 'application/pdf',
      contentDisposition: `inline; filename="receipt-${receiptNumber}.pdf"`,
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
          this.localLogger.warn(`media insert failed: ${(err as Error).message}`);
          return null;
        });

      if (asset) {
        await this.donations.setReceiptAsset(donation.id, asset.id);
      }
    }

    if (donation.donor_email || donation.donor_user_id) {
      await this.fanoutQueue
        .add('donation.receipt.ready', {
          event: 'donation.receipt.ready',
          recipient_user_ids: donation.donor_user_id ? [donation.donor_user_id] : [],
          recipient_emails: donation.donor_email ? [donation.donor_email] : [],
          source: { kind: 'donation', id: donation.id },
          data: {
            amount_inr: donation.amount_paise / 100,
            receipt_number: receiptNumber,
            donor_name: donation.donor_name,
            financial_year: financialYear,
          },
          deep_link: `/donations/${donation.id}`,
        })
        .catch((err) =>
          this.localLogger.warn(`receipt fanout enqueue failed: ${(err as Error).message}`),
        );
    }

    this.localLogger.log(
      `receipt ${receiptNumber} (${pdfBytes.length} bytes, via=pdfkit) uploaded to ${objectKey}`,
    );

    return {
      donation_id: donation.id,
      asset_id: asset?.id ?? null,
      s3_key: objectKey,
      bytes: pdfBytes.length,
      via: 'pdfkit',
    };
  }
}
