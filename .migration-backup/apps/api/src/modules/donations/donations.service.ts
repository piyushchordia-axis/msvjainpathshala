/**
 * DonationsService — orchestrates the donation life cycle
 * (SPEC §6.21, §8.8, CLAUDE.md Q3).
 *
 * Three primary entry points:
 *
 *   1. createOrder()            initiate flow — creates `donations` row
 *                                 with status='created', returns Razorpay
 *                                 order_id for the client checkout.
 *
 *   2. verifyAndCapture()       client-side success path — verifies the
 *                                 client-submitted signature, transitions
 *                                 status to 'captured', enqueues receipt
 *                                 + 80G cert jobs.
 *
 *   3. handleWebhook()          server-to-server source of truth
 *                                 (SPEC §8.8). Verifies webhook signature,
 *                                 deduplicates via donation_webhook_events,
 *                                 transitions status, enqueues post-capture
 *                                 jobs (idempotent — second delivery is a
 *                                 no-op).
 *
 * Q3 (CLAUDE.md): the 80G certificate job is enqueued ONLY when:
 *     platform_settings.eighty_g_enabled = true   AND
 *     donations.donor_pan IS NOT NULL
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { DonationsRepository } from '../../db/repositories/donations.repository';
import { PlatformSettingsRepository } from '../../db/repositories/platform-settings.repository';
import { QUEUES } from '../../queues/queues.constants';
import { AuditService } from '../audit/audit.service';

import { PanEncryptionService } from './pan-encryption.service';
import { RazorpayService } from './razorpay.service';

import type { Donation } from '../../db/schema';

export interface DonationActor {
  user_id?: string;
  role?: Role;
  ip?: string | null;
}

export interface CreateOrderInput {
  amount_paise: number;
  currency?: string;
  purpose: 'general' | 'shivir' | 'scholarship' | 'infrastructure';
  campaign_id?: string | null;
  frequency?: 'one_time' | 'recurring';
  donor: {
    name: string;
    email?: string | null;
    phone?: string | null;
    pan?: string | null;
  };
  notes?: string | null;
}

export interface VerifyInput {
  donation_id?: string;
  order_id: string;
  payment_id: string;
  signature: string;
}

export interface WebhookEventPayload {
  event_id: string;
  event_type: string;
  payload: {
    payment?: { entity?: { id: string; order_id: string; amount: number; created_at?: number } };
  };
}

/** Receipt-number prefix used by the receipt + 80G processors. */
function buildReceiptNumber(now: Date, donationId: string): string {
  const fy = financialYearLabel(now);
  const short = donationId.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `JP-${fy}-${short}`;
}

function financialYearLabel(d: Date): string {
  // Indian FY starts April 1 (CLAUDE.md cron jobs run in IST).
  const month = d.getUTCMonth(); // 0-based
  const year = d.getUTCFullYear();
  const startYear = month >= 3 ? year : year - 1;
  const endYY = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYY}`;
}

@Injectable()
export class DonationsService {
  private readonly logger = new Logger(DonationsService.name);

  constructor(
    private readonly repo: DonationsRepository,
    private readonly settings: PlatformSettingsRepository,
    private readonly razorpay: RazorpayService,
    private readonly pan: PanEncryptionService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.DONATION_RECEIPT_GENERATE) private readonly receiptQueue: Queue,
    @InjectQueue(QUEUES.DONATION_EIGHTYG_CERT) private readonly eightyGQueue: Queue,
  ) {}

  // ===========================================================================
  // 1. Create order (initiate)
  // ===========================================================================

  async createOrder(
    actor: DonationActor,
    input: CreateOrderInput,
  ): Promise<{
    donation: Donation;
    razorpay_order_id: string;
    razorpay_key_id: string;
    amount_paise: number;
    currency: string;
  }> {
    if (input.amount_paise < 100) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'Minimum donation is ₹1 (100 paise)',
        statusCode: 422,
      });
    }
    if (input.amount_paise > 10_00_00_000) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'Maximum donation is ₹10 crore',
        statusCode: 422,
      });
    }

    const currency = input.currency ?? 'INR';
    const encryptedPan = this.pan.encryptPan(input.donor.pan ?? null);
    const settings = await this.settings.get();

    // Pre-insert the donations row with a fresh UUID so the receipt
    // number includes the donation id (stable across captures).
    const created = await this.repo.create({
      donor_user_id: actor.user_id ?? null,
      donor_name: input.donor.name,
      donor_phone: input.donor.phone ?? null,
      donor_email: input.donor.email ?? null,
      donor_pan: encryptedPan,
      amount_paise: input.amount_paise,
      currency,
      purpose: input.purpose,
      campaign_id: input.campaign_id ?? null,
      frequency: input.frequency ?? 'one_time',
      status: 'created',
      eighty_g_eligible: settings.eighty_g_enabled && Boolean(encryptedPan),
      notes: input.notes ?? null,
    });

    // Razorpay receipt is the donation id itself — easy to correlate.
    const order = await this.razorpay.createOrder({
      amount_paise: input.amount_paise,
      currency,
      receipt: created.id,
      notes: { donation_id: created.id, purpose: input.purpose },
    });

    // Bind the razorpay_order_id to the donation row so verify + webhook
    // can resolve back to it.
    await this.repo.setOrderId(created.id, order.id);
    const persisted = (await this.repo.findById(created.id)) ?? created;

    return {
      donation: persisted,
      razorpay_order_id: order.id,
      razorpay_key_id: this.razorpay.isLive ? '<configured via env>' : 'rzp_test_stub',
      amount_paise: created.amount_paise,
      currency,
    };
  }

  // ===========================================================================
  // 2. Verify (client-side success)
  // ===========================================================================

  async verifyAndCapture(input: VerifyInput): Promise<Donation> {
    const valid = this.razorpay.verifyPaymentSignature({
      order_id: input.order_id,
      payment_id: input.payment_id,
      signature: input.signature,
    });
    if (!valid) {
      throw new AppError({
        code: ERROR_CODES.ERR_DONATION_WEBHOOK_SIGNATURE,
        message: 'Invalid Razorpay signature',
        statusCode: 401,
      });
    }
    const found = await this.repo.findByOrderId(input.order_id);
    if (!found) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'No donation matches that order',
        statusCode: 404,
      });
    }
    return this.capture(found, input.payment_id, input.signature, new Date());
  }

  // ===========================================================================
  // 3. Webhook (server-to-server source of truth)
  // ===========================================================================

  async handleWebhook(
    rawBody: string,
    signatureHeader: string,
    parsed: WebhookEventPayload,
  ): Promise<{ duplicate: boolean; donation_id: string | null }> {
    if (!this.razorpay.verifyWebhookSignature(rawBody, signatureHeader)) {
      throw new AppError({
        code: ERROR_CODES.ERR_DONATION_WEBHOOK_SIGNATURE,
        message: 'Webhook signature mismatch',
        statusCode: 401,
      });
    }

    const payment = parsed.payload?.payment?.entity;
    if (!payment) {
      // Non-payment event (refund, settlement, etc.) — we ignore but still
      // record so duplicates remain de-duped.
      const accepted = await this.repo.recordEvent({
        event_id: parsed.event_id,
        event_type: parsed.event_type,
        razorpay_payment_id: null,
        razorpay_order_id: null,
        payload: parsed as unknown as Record<string, unknown>,
      });
      return { duplicate: !accepted, donation_id: null };
    }

    const accepted = await this.repo.recordEvent({
      event_id: parsed.event_id,
      event_type: parsed.event_type,
      razorpay_payment_id: payment.id,
      razorpay_order_id: payment.order_id,
      payload: parsed as unknown as Record<string, unknown>,
    });
    if (!accepted) {
      this.logger.log(`webhook duplicate event_id=${parsed.event_id} ignored`);
      // Find the donation we'd previously associated for the response shape.
      const existing = await this.repo.findByPaymentId(payment.id);
      return { duplicate: true, donation_id: existing?.id ?? null };
    }

    if (parsed.event_type !== 'payment.captured') {
      // Other event types: just record and exit. Future steps wire
      // refund.processed → reverse donations.status.
      return { duplicate: false, donation_id: null };
    }

    const donation = await this.repo.findByOrderId(payment.order_id);
    if (!donation) {
      this.logger.warn(`webhook payment.captured for unknown order ${payment.order_id}`);
      return { duplicate: false, donation_id: null };
    }
    const captured = await this.capture(
      donation,
      payment.id,
      null,
      payment.created_at ? new Date(payment.created_at * 1000) : new Date(),
    );
    await this.repo.markEventProcessed(parsed.event_id, captured.id);
    return { duplicate: false, donation_id: captured.id };
  }

  // ===========================================================================
  // Shared capture path
  // ===========================================================================

  private async capture(
    donation: Donation,
    paymentId: string,
    signature: string | null,
    capturedAt: Date,
  ): Promise<Donation> {
    const receiptNumber = donation.receipt_number ?? buildReceiptNumber(capturedAt, donation.id);
    const fy = financialYearLabel(capturedAt);
    const { donation: updated, wasNewlyCaptured } = await this.repo.markCaptured(donation.id, {
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
      payment_captured_at: capturedAt,
      receipt_number: receiptNumber,
      financial_year: fy,
    });

    if (!wasNewlyCaptured) {
      this.logger.log(`donation ${updated.id} already captured — skipping post-capture queues`);
      return updated;
    }

    // Q3 — only enqueue the 80G cert when both conditions hold.
    const settings = await this.settings.get();
    const eightyGEligible = settings.eighty_g_enabled && Boolean(updated.donor_pan);

    await this.receiptQueue
      .add(
        'donation.receipt.generate',
        { donation_id: updated.id },
        { jobId: `donation.receipt:${updated.id}`, removeOnComplete: true },
      )
      .catch((err) => this.logger.warn(`receipt enqueue failed: ${(err as Error).message}`));

    if (eightyGEligible) {
      await this.eightyGQueue
        .add(
          'donation.eightyg.cert',
          { donation_id: updated.id },
          { jobId: `donation.eightyg:${updated.id}`, removeOnComplete: true },
        )
        .catch((err) => this.logger.warn(`80G enqueue failed: ${(err as Error).message}`));
    } else {
      this.logger.log(
        `80G cert skipped donation=${updated.id} eighty_g_enabled=${settings.eighty_g_enabled} pan_set=${Boolean(updated.donor_pan)}`,
      );
    }

    await this.audit
      .emit({
        actor_user_id: updated.donor_user_id ?? '00000000-0000-0000-0000-000000000000',
        actor_role: 'guest',
        action: 'create',
        entity_kind: 'donation',
        entity_id: updated.id,
        after: {
          amount_paise: updated.amount_paise,
          status: updated.status,
          receipt_number: receiptNumber,
          eighty_g_enqueued: eightyGEligible,
        },
      })
      .catch(() => undefined);

    return updated;
  }

  // ===========================================================================
  // Read helpers
  // ===========================================================================

  async listForDonor(userId: string): Promise<Donation[]> {
    return this.repo.listForDonor(userId);
  }

  async listForAdmin(): Promise<Donation[]> {
    return this.repo.listForAdmin({});
  }

  async getById(id: string): Promise<Donation> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Donation not found',
        statusCode: 404,
      });
    }
    return row;
  }
}
