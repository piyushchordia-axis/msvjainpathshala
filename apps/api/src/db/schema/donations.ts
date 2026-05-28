/** Donations + campaigns + donor profiles (SPEC §5.17). */

import { bigint, boolean, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import { softDelete, timestamps } from './_helpers';
import { donationFrequencyEnum, donationPurposeEnum, paymentStatusEnum } from './enums';
import { cities } from './geography';
import { users } from './identity';

export const donation_campaigns = pgTable('donation_campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  city_id: uuid('city_id').references(() => cities.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  description: text('description'),
  target_amount_paise: bigint('target_amount_paise', { mode: 'number' }),
  // Denormalised running total; updated transactionally on each capture.
  raised_amount_paise: bigint('raised_amount_paise', { mode: 'number' }).notNull().default(0),
  starts_at: timestamp('starts_at', { withTimezone: true }),
  ends_at: timestamp('ends_at', { withTimezone: true }),
  is_public: boolean('is_public').notNull().default(false),
  progress_bar_visible: boolean('progress_bar_visible').notNull().default(false),
  ...softDelete(),
  ...timestamps(),
});

export const donations = pgTable('donations', {
  id: uuid('id').primaryKey().defaultRandom(),
  donor_name: text('donor_name').notNull(),
  donor_phone: varchar('donor_phone', { length: 15 }),
  donor_email: varchar('donor_email', { length: 255 }),
  // PII — encrypted at the application layer (CLAUDE.md security rules).
  donor_pan: text('donor_pan'),
  amount_paise: bigint('amount_paise', { mode: 'number' }).notNull(),
  currency: text('currency').notNull().default('INR'),
  purpose: donationPurposeEnum('purpose').notNull(),
  campaign_id: uuid('campaign_id').references(() => donation_campaigns.id, {
    onDelete: 'set null',
  }),
  frequency: donationFrequencyEnum('frequency').notNull(),
  razorpay_order_id: text('razorpay_order_id'),
  razorpay_payment_id: text('razorpay_payment_id'),
  razorpay_signature: text('razorpay_signature'),
  status: paymentStatusEnum('status').notNull().default('created'),
  payment_captured_at: timestamp('payment_captured_at', { withTimezone: true }),
  eighty_g_eligible: boolean('eighty_g_eligible').notNull().default(false),
  receipt_number: text('receipt_number'),
  eighty_g_certificate_asset_id: uuid('eighty_g_certificate_asset_id'),
  notes: text('notes'),
  ...softDelete(),
  ...timestamps(),
});

export const donor_profiles = pgTable('donor_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 15 }),
  // Hash of PAN for lookup without storing PAN itself.
  pan_hash: text('pan_hash'),
  total_donated_paise: bigint('total_donated_paise', { mode: 'number' }).notNull().default(0),
  ...timestamps(),
});

export type DonationCampaign = typeof donation_campaigns.$inferSelect;
export type NewDonationCampaign = typeof donation_campaigns.$inferInsert;
export type Donation = typeof donations.$inferSelect;
export type NewDonation = typeof donations.$inferInsert;
export type DonorProfile = typeof donor_profiles.$inferSelect;
export type NewDonorProfile = typeof donor_profiles.$inferInsert;
