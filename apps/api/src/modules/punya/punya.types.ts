/**
 * Shared types for the Punya module — used by service, controller, and
 * processors. Kept thin: domain primitives come from `@jp/shared` / the
 * Drizzle schema.
 */

import type { PunyaBalance, PunyaTransaction } from '../../db/schema';
import type { Tier } from '@jp/shared';

export type LeaderboardScope = 'batch' | 'centre' | 'city' | 'national' | 'msv';

export const LEADERBOARD_SCOPES: readonly LeaderboardScope[] = [
  'batch',
  'centre',
  'city',
  'national',
  'msv',
] as const;

export interface LeaderboardEntry {
  rank: number;
  student_id: string;
  full_name: string;
  student_code: string;
  age_group: string;
  centre_id: string | null;
  centre_name: string | null;
  total_points: number;
}

export interface LeaderboardResult {
  scope: LeaderboardScope;
  scope_id: string | null;
  period: string; // 'YYYY-MM'
  entries: LeaderboardEntry[];
  /** Caller's rank within the same ZSET, when known. */
  self_rank: number | null;
}

export interface AwardResult {
  transaction: PunyaTransaction;
  balance: PunyaBalance | null;
  duplicate: boolean;
  previous_tier?: Tier;
  new_tier?: Tier;
  tier_upgraded?: boolean;
}

export interface ReverseResultDto {
  reversal_id: string;
  source_id: string;
  balance: PunyaBalance;
  previous_tier: Tier;
  new_tier: Tier;
  tier_downgraded: boolean;
}

/**
 * Domain event emitted on a tier upgrade. We deliberately keep this loose
 * (a plain object on the BullMQ queue) — the processor that consumes it
 * lives in the worker entry, where Nest's DI is also wired.
 */
export interface PunyaTierUpgradeEvent {
  student_id: string;
  parent_user_id: string;
  previous_tier: Tier;
  new_tier: Tier;
  total_points: number;
  triggered_by_transaction_id: string;
}
