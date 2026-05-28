/**
 * Punya + leaderboard endpoint wrappers used by the parent + student-view
 * screens (Step 16).
 *
 * Surface mirrors the API contract in apps/api/src/modules/punya/* — keep
 * the shapes in lockstep when adding fields.
 */

import { api, unwrap } from '../client';

export type Tier = 'jigyasu' | 'shravak' | 'sadhak' | 'shraman' | 'tirthankar';
export type LeaderboardScope = 'batch' | 'centre' | 'city' | 'national' | 'msv';

export interface PunyaBalanceDto {
  student_id: string;
  total_points: number;
  msv_points: number;
  current_tier: Tier;
  tier_reached_at: string | null;
  last_updated_at: string;
}

export interface TierProgressDto {
  current: Tier;
  next: Tier | null;
  lowerBound: number;
  upperBound: number | null;
  pointsIntoTier: number;
  pointsToNext: number | null;
  pct: number; // 0..1
}

export interface PunyaBalanceResponse {
  balance: PunyaBalanceDto | null;
  progress: TierProgressDto;
}

export interface PunyaTransactionDto {
  id: string;
  student_id: string;
  feature_key: string;
  points: number;
  reason: string | null;
  awarded_at: string;
  source_entity_kind: string;
  source_entity_id: string;
  reversal_of: string | null;
}

export interface PunyaTransactionsResponse {
  items: PunyaTransactionDto[];
  next_cursor: string | null;
}

export interface LeaderboardEntryDto {
  rank: number;
  student_id: string;
  full_name: string;
  student_code: string;
  age_group: string;
  centre_id: string | null;
  centre_name: string | null;
  total_points: number;
}

export interface LeaderboardResponse {
  scope: LeaderboardScope;
  scope_id: string | null;
  period: string;
  entries: LeaderboardEntryDto[];
  self_rank: number | null;
}

export const punyaApi = {
  async balance(studentId: string): Promise<PunyaBalanceResponse> {
    return unwrap<PunyaBalanceResponse>(api.get(`/v1/students/${studentId}/punya/balance`));
  },

  async transactions(
    studentId: string,
    opts: { limit?: number; before?: string } = {},
  ): Promise<PunyaTransactionsResponse> {
    return unwrap<PunyaTransactionsResponse>(
      api.get(`/v1/students/${studentId}/punya/transactions`, { params: opts }),
    );
  },

  async tierProgress(studentId: string): Promise<TierProgressDto> {
    return unwrap<TierProgressDto>(api.get(`/v1/students/${studentId}/punya/tier-progress`));
  },

  async leaderboard(
    scope: LeaderboardScope,
    opts: {
      scope_id?: string;
      period?: string;
      limit?: number;
      for_student_id?: string;
    } = {},
  ): Promise<LeaderboardResponse> {
    return unwrap<LeaderboardResponse>(api.get(`/v1/leaderboards/${scope}`, { params: opts }));
  },
};

/**
 * Map a tier id to its locked design-system colour. Mirrors the colours in
 * jp-design-system/tokens.json color.tier.*.
 *
 * Keep in sync with `JPColors.tier*` — duplicated here for ergonomics in
 * downstream components that only need the hex.
 */
export const TIER_COLORS: Record<Tier, string> = {
  jigyasu: '#8B6F5E',
  shravak: '#166534',
  sadhak: '#1E3A8A',
  shraman: '#7A1818',
  tirthankar: '#C8941F',
};

/** Soft, ~12% tinted backgrounds used by the badges + balance card. */
export const TIER_BG: Record<Tier, string> = {
  jigyasu: '#F5EDE0',
  shravak: '#DCEEDD',
  sadhak: '#DDE3F4',
  shraman: '#F4E6E6',
  tirthankar: '#FAF1DC',
};

export const TIER_LABEL: Record<Tier, string> = {
  jigyasu: 'Jigyasu',
  shravak: 'Shravak',
  sadhak: 'Sadhak',
  shraman: 'Shraman',
  tirthankar: 'Tirthankar',
};

export const TIER_LABEL_HI: Record<Tier, string> = {
  jigyasu: 'जिज्ञासु',
  shravak: 'श्रावक',
  sadhak: 'साधक',
  shraman: 'श्रमण',
  tirthankar: 'तीर्थंकर',
};

export const TIER_SUBTITLE: Record<Tier, string> = {
  jigyasu: 'Learner',
  shravak: 'Listener',
  sadhak: 'Seeker',
  shraman: 'Ascetic',
  tirthankar: 'Enlightened',
};
