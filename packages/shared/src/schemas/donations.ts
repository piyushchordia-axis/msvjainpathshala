/** Donation DTOs (SPEC §5.17, §6.21, §8.8, CLAUDE.md Q3 — 80G toggle). */

import { z } from 'zod';

import { DONATION_FREQUENCIES, DONATION_PURPOSES, PAYMENT_STATUSES } from '../enums/donation.js';

import { email, isoDatetime, phone, uuid } from './common.js';

export const donationCreateSchema = z.object({
  amount_inr: z.number().int().min(1).max(10_00_00_000), // up to ₹10 crore
  purpose: z.enum(DONATION_PURPOSES),
  frequency: z.enum(DONATION_FREQUENCIES).default('one_time'),
  campaign_id: uuid.nullable().optional(),
  /** Donor details captured for 80G certificate generation. */
  donor: z.object({
    full_name: z.string().min(1).max(200),
    email: email.optional(),
    phone: phone.optional(),
    pan: z
      .string()
      .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN must be 5 letters + 4 digits + 1 letter')
      .optional(),
    address: z.string().max(500).optional(),
  }),
});
export type DonationCreateDto = z.infer<typeof donationCreateSchema>;

export const donationSchema = z.object({
  id: uuid,
  amount_inr: z.number().int(),
  purpose: z.enum(DONATION_PURPOSES),
  frequency: z.enum(DONATION_FREQUENCIES),
  campaign_id: uuid.nullable(),
  payment_status: z.enum(PAYMENT_STATUSES),
  razorpay_order_id: z.string().nullable(),
  razorpay_payment_id: z.string().nullable(),
  receipt_asset_id: uuid.nullable(),
  eighty_g_cert_asset_id: uuid.nullable(),
  created_at: isoDatetime,
  updated_at: isoDatetime,
});
export type DonationDto = z.infer<typeof donationSchema>;

export const eightyGToggleSchema = z
  .object({
    enabled: z.boolean(),
    /** Required when toggling on (CLAUDE.md Q3). */
    eighty_g_registration_number: z.string().min(1).max(50).optional(),
    organization_pan: z
      .string()
      .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.enabled && (!val.eighty_g_registration_number || !val.organization_pan)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Both eighty_g_registration_number and organization_pan are required when enabling 80G (CLAUDE.md Q3)',
      });
    }
  });
export type EightyGToggleDto = z.infer<typeof eightyGToggleSchema>;
