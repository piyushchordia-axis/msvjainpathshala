/**
 * DonationsRepository — write/read helpers for the donations + campaigns
 * + webhook-events tables (SPEC §5.17, §6.21).
 *
 * - `donations` rows are created via `create()` from the order-initiate
 *   flow with status='created'. The verify / webhook handlers UPSERT
 *   via `markCaptured()` which is idempotent on `razorpay_payment_id`.
 * - `donation_webhook_events` is append-only — `recordEvent()` returns
 *   `false` on conflict so the caller knows it's a duplicate delivery.
 * - Campaign `raised_amount_paise` is bumped atomically inside the same
 *   transaction as the capture; never updated via separate cron.
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { donation_campaigns, donation_webhook_events, donations, donor_profiles } from '../schema';

import type {
  Donation,
  DonationCampaign,
  DonorProfile,
  NewDonation,
  NewDonationCampaign,
  NewDonationWebhookEvent,
  NewDonorProfile,
} from '../schema';

@Injectable()
export class DonationsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  // ===========================================================================
  // donations
  // ===========================================================================

  async create(input: NewDonation): Promise<Donation> {
    const [row] = await this.drizzle.db.insert(donations).values(input).returning();
    if (!row) throw new Error('[Donations.create] no row returned');
    return row;
  }

  async findById(id: string): Promise<Donation | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(donations)
      .where(eq(donations.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByOrderId(orderId: string): Promise<Donation | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(donations)
      .where(eq(donations.razorpay_order_id, orderId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByPaymentId(paymentId: string): Promise<Donation | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(donations)
      .where(eq(donations.razorpay_payment_id, paymentId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Mark a donation as captured. Idempotent — re-calling with the same
   * payment_id returns the existing row unchanged. Used by both the verify
   * endpoint and the webhook handler so race-y double-deliveries don't
   * cause double-receipts.
   *
   * Returns `{ donation, wasNewlyCaptured }` so the caller can decide
   * whether to enqueue receipt / 80G jobs.
   */
  async markCaptured(
    id: string,
    payload: {
      razorpay_payment_id: string;
      razorpay_signature: string | null;
      payment_captured_at: Date;
      receipt_number: string;
      financial_year: string;
    },
  ): Promise<{ donation: Donation; wasNewlyCaptured: boolean }> {
    return this.drizzle.db.transaction(async (tx) => {
      const before = await tx
        .select()
        .from(donations)
        .where(eq(donations.id, id))
        .for('update')
        .limit(1);
      const existing = before[0];
      if (!existing) throw new Error(`[Donations.markCaptured] donation ${id} not found`);

      if (existing.status === 'captured') {
        return { donation: existing, wasNewlyCaptured: false };
      }

      const [updated] = await tx
        .update(donations)
        .set({
          status: 'captured',
          razorpay_payment_id: payload.razorpay_payment_id,
          razorpay_signature: payload.razorpay_signature,
          payment_captured_at: payload.payment_captured_at,
          receipt_number: payload.receipt_number,
          financial_year: payload.financial_year,
          updated_at: new Date(),
        })
        .where(eq(donations.id, id))
        .returning();
      if (!updated) throw new Error('[Donations.markCaptured] update returned no row');

      // Bump the campaign running total transactionally.
      if (updated.campaign_id) {
        await tx
          .update(donation_campaigns)
          .set({
            raised_amount_paise: sql`${donation_campaigns.raised_amount_paise} + ${updated.amount_paise}`,
            updated_at: new Date(),
          })
          .where(eq(donation_campaigns.id, updated.campaign_id));
      }

      return { donation: updated, wasNewlyCaptured: true };
    });
  }

  async setOrderId(id: string, orderId: string): Promise<void> {
    await this.drizzle.db
      .update(donations)
      .set({ razorpay_order_id: orderId, updated_at: new Date() })
      .where(eq(donations.id, id));
  }

  async setReceiptAsset(id: string, assetId: string): Promise<void> {
    await this.drizzle.db
      .update(donations)
      .set({ receipt_asset_id: assetId, updated_at: new Date() })
      .where(eq(donations.id, id));
  }

  async setEightyGAsset(id: string, assetId: string): Promise<void> {
    await this.drizzle.db
      .update(donations)
      .set({
        eighty_g_certificate_asset_id: assetId,
        eighty_g_eligible: true,
        updated_at: new Date(),
      })
      .where(eq(donations.id, id));
  }

  async listForDonor(userId: string, limit = 50): Promise<Donation[]> {
    return this.drizzle.dbRead
      .select()
      .from(donations)
      .where(and(eq(donations.donor_user_id, userId), isNull(donations.deleted_at)))
      .orderBy(desc(donations.payment_captured_at))
      .limit(limit);
  }

  async listForAdmin(
    filters: { status?: 'created' | 'captured' | 'failed' | 'refunded'; limit?: number } = {},
  ): Promise<Donation[]> {
    const where = [isNull(donations.deleted_at)];
    if (filters.status) where.push(eq(donations.status, filters.status));
    return this.drizzle.dbRead
      .select()
      .from(donations)
      .where(and(...where))
      .orderBy(desc(donations.created_at))
      .limit(filters.limit ?? 100);
  }

  // ===========================================================================
  // donation_webhook_events
  // ===========================================================================

  /**
   * Record a webhook event. Returns `true` if this is the first time we've
   * seen the event_id, `false` for duplicate deliveries. Idempotency
   * enforced via PRIMARY KEY (event_id).
   */
  async recordEvent(input: NewDonationWebhookEvent): Promise<boolean> {
    const [row] = await this.drizzle.db
      .insert(donation_webhook_events)
      .values(input)
      .onConflictDoNothing({ target: donation_webhook_events.event_id })
      .returning();
    return Boolean(row);
  }

  async markEventProcessed(eventId: string, donationId: string | null): Promise<void> {
    await this.drizzle.db
      .update(donation_webhook_events)
      .set({ processed_at: new Date(), donation_id: donationId })
      .where(eq(donation_webhook_events.event_id, eventId));
  }

  // ===========================================================================
  // donation_campaigns
  // ===========================================================================

  async createCampaign(input: NewDonationCampaign): Promise<DonationCampaign> {
    const [row] = await this.drizzle.db.insert(donation_campaigns).values(input).returning();
    if (!row) throw new Error('[Donations.createCampaign] no row returned');
    return row;
  }

  async findCampaignById(id: string): Promise<DonationCampaign | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(donation_campaigns)
      .where(eq(donation_campaigns.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listPublicCampaigns(limit = 20): Promise<DonationCampaign[]> {
    return this.drizzle.dbRead
      .select()
      .from(donation_campaigns)
      .where(and(eq(donation_campaigns.is_public, true), isNull(donation_campaigns.deleted_at)))
      .orderBy(desc(donation_campaigns.created_at))
      .limit(limit);
  }

  // ===========================================================================
  // donor_profiles
  // ===========================================================================

  async findDonorByPanHash(panHash: string): Promise<DonorProfile | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(donor_profiles)
      .where(eq(donor_profiles.pan_hash, panHash))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertDonorProfile(input: NewDonorProfile): Promise<DonorProfile> {
    const [row] = await this.drizzle.db
      .insert(donor_profiles)
      .values(input)
      .onConflictDoUpdate({
        target: donor_profiles.pan_hash,
        set: {
          name: input.name,
          email: input.email,
          phone: input.phone,
          total_donated_paise: sql`${donor_profiles.total_donated_paise} + ${input.total_donated_paise ?? 0}`,
          updated_at: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('[Donations.upsertDonorProfile] no row returned');
    return row;
  }
}
