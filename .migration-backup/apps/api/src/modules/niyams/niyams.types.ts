/**
 * Niyams module shared types (SPEC §5.8, §6.10).
 */

import type { NiyamSubmission, Niyam, NiyamStreak } from '../../db/schema';
import type { NiyamType, ProofType } from '@jp/shared';

export interface CreateNiyamInput {
  title_en: string;
  title_hi: string;
  description_en?: string | null;
  description_hi?: string | null;
  type: NiyamType;
  start_date: string; // YYYY-MM-DD
  end_date?: string | null;
  audience_kind: 'all' | 'msv_only' | 'age_group' | 'batch' | 'centre' | 'city';
  audience_filters?: {
    age_groups?: string[];
    batch_ids?: string[];
    centre_ids?: string[];
  } | null;
  proof_type: ProofType;
  points_value: number;
  reference_asset_id?: string | null;
  msv_only?: boolean;
}

export interface SubmitNiyamInput {
  student_id: string;
  proof_asset_id: string;
  client_op_id?: string;
}

export interface SubmitNiyamResult {
  submission_id: string;
  status: 'auto_approved';
  punya_transaction_id: string;
  points_awarded: number;
  gallery_item_id: string | null;
  duplicate: boolean;
  submission_date: string;
}

export interface RejectNiyamInput {
  reason: string;
}

export interface RejectNiyamResult {
  submission_id: string;
  reversal_transaction_id: string;
  points_reversed: number;
  gallery_hidden: boolean;
}

export interface StreakSummary {
  niyam_id: string;
  niyam_title_en: string;
  niyam_title_hi: string;
  current_streak: number;
  longest_streak: number;
  last_completion_date: string | null;
  badge_kind: string | null;
}

export interface SubmissionRow {
  id: string;
  niyam_id: string;
  niyam_title_en: string;
  niyam_title_hi: string;
  niyam_type: NiyamType;
  points_value: number;
  status: NiyamSubmission['status'];
  submitted_at: string;
  submission_date: string;
  proof_asset_id: string;
  rejected_at: string | null;
  rejection_reason: string | null;
}

export interface NiyamForCallerRow {
  id: string;
  title_en: string;
  title_hi: string;
  description_en: string | null;
  description_hi: string | null;
  type: NiyamType;
  proof_type: ProofType;
  points_value: number;
  start_date: string;
  end_date: string | null;
  msv_only: boolean;
  /** Already submitted today (for daily) / this week (weekly) / this month (monthly). */
  submitted_for_current_period: boolean;
}

/** Niyam queue event payloads. */
export interface NiyamStreakRecomputePayload {
  /** Specific (student, niyam) to recompute. When null we recompute for ALL niyams the student has submitted. */
  niyam_id: string | null;
  student_id: string;
  /** Reason — pure metadata, useful for tracing. */
  reason: 'submission' | 'rejection' | 'manual';
  /** Pre-computed milestones the processor should skip awarding (idempotency). */
  skip_award?: boolean;
}

/** Niyam streak milestone thresholds; awarding Punya at each crossing. */
export const NIYAM_STREAK_MILESTONES: readonly number[] = [7, 14, 30, 60, 100] as const;

/** Streak milestones (per BRD §8.5 referenced in SPEC §5.8 streak logic). */
export const NIYAM_BADGE_KINDS: Record<number, string> = {
  7: 'streak_7d',
  14: 'streak_14d',
  30: 'streak_30d',
  60: 'streak_60d',
  100: 'streak_100d',
};

export type NiyamLookups = {
  niyam: Niyam;
  streak: NiyamStreak | null;
};
