/**
 * Competitions module — DTOs and result envelopes (SPEC §5.12, §6.15).
 */

import type { Competition, CompetitionRegistration } from '../../db/schema';
import type { AgeGroup } from '@jp/shared';

export interface CreateCompetitionInput {
  name_en: string;
  name_hi: string;
  description_en?: string | null;
  description_hi?: string | null;
  category?: string | null;
  eligible_age_groups?: AgeGroup[] | null;
  msv_only?: boolean;
  registration_window_start?: string | null;
  registration_window_end?: string | null;
  event_date?: string | null;
  winner_points?: number;
  participant_points?: number;
  max_participants?: number | null;
  status?: 'draft' | 'open' | 'closed' | 'results_published';
}

export interface RegisterCompetitionInput {
  student_id: string;
}

export interface RecordResultsInput {
  results: Array<{
    student_id: string;
    rank: number | null;
    note?: string | null;
  }>;
}

export interface CompetitionRegistrationWithStudent {
  registration: CompetitionRegistration;
  student_full_name: string;
  student_code: string;
  age_group: string;
}

export interface RecordResultsResult {
  recorded: number;
  competition: Competition;
}

export interface PublishResultsResult {
  competition: Competition;
  punya_awards: number;
  winners_notified: number;
}
