/**
 * Donations endpoint wrappers (SPEC §6.21) used by the parent donations
 * screen. Mirrors apps/api/src/modules/donations/*.
 *
 *   GET /v1/donations/me          donor history (jwt)
 *   GET /v1/donations/campaigns   public campaign listing
 *
 * Live Razorpay checkout (initiate/verify) needs the native checkout SDK and
 * is intentionally out of scope here; this surface is read-only history +
 * active campaigns.
 */

import { api, unwrap } from '../client';

export type DonationPurpose = 'general' | 'shivir' | 'scholarship' | 'infrastructure';
export type DonationStatus = 'created' | 'captured' | 'failed' | 'refunded';

export interface DonationRow {
  id: string;
  campaign_id: string | null;
  amount_paise: number;
  currency: string;
  purpose: DonationPurpose;
  status: DonationStatus;
  frequency: 'one_time' | 'recurring';
  donor_name: string;
  receipt_asset_id: string | null;
  eighty_g_certificate_asset_id: string | null;
  created_at: string;
}

export interface DonationCampaignRow {
  id: string;
  name: string;
  description: string | null;
  target_amount_paise: number | null;
  raised_amount_paise: number;
  progress_bar_visible: boolean;
  starts_at: string | null;
  ends_at: string | null;
}

export const donationsApi = {
  async listMine(): Promise<{ items: DonationRow[] }> {
    return unwrap<{ items: DonationRow[] }>(api.get('/v1/donations/me'));
  },

  async listCampaigns(limit = 20): Promise<{ items: DonationCampaignRow[] }> {
    return unwrap<{ items: DonationCampaignRow[] }>(
      api.get('/v1/donations/campaigns', { params: { limit } }),
    );
  },
};
