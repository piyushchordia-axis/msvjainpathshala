/**
 * `donation_purpose_enum`, `donation_frequency_enum`, `payment_status_enum`
 * (SPEC §5.1).
 *
 * 80G toggle (CLAUDE.md Q3): `platform_settings.eighty_g_enabled` controls
 * whether certificates are generated. The toggle is rejected if either
 * `eighty_g_registration_number` or `organization_pan` is empty.
 */

export const DONATION_PURPOSES = ['general', 'shivir', 'scholarship', 'infrastructure'] as const;
export type DonationPurpose = (typeof DONATION_PURPOSES)[number];

export const DONATION_FREQUENCIES = ['one_time', 'recurring'] as const;
export type DonationFrequency = (typeof DONATION_FREQUENCIES)[number];

export const PAYMENT_STATUSES = [
  'created',
  'authorized',
  'captured',
  'failed',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
