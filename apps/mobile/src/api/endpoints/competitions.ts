/**
 * Competitions endpoint wrappers used by the parent / student-view competition
 * screens (Step 18).
 */

import { api, unwrap } from '../client';

export type CompetitionStatus = 'draft' | 'open' | 'closed' | 'results_published';

export interface CompetitionDto {
  id: string;
  city_id: string;
  name_en: string;
  name_hi: string;
  description_en: string | null;
  description_hi: string | null;
  category: string | null;
  eligible_age_groups: string[] | null;
  msv_only: boolean;
  registration_window_start: string | null;
  registration_window_end: string | null;
  event_date: string | null;
  winner_points: number;
  participant_points: number;
  max_participants: number | null;
  status: CompetitionStatus;
  results_published_at: string | null;
}

export interface CompetitionRegistrationDto {
  id: string;
  competition_id: string;
  student_id: string;
  registered_at: string;
  result_rank: number | null;
  result_note: string | null;
}

export const competitionsApi = {
  async listForCaller(studentId?: string): Promise<{ items: CompetitionDto[] }> {
    return unwrap<{ items: CompetitionDto[] }>(
      api.get('/v1/competitions', { params: studentId ? { student_id: studentId } : {} }),
    );
  },

  async register(
    competitionId: string,
    body: { student_id: string },
  ): Promise<CompetitionRegistrationDto> {
    return unwrap<CompetitionRegistrationDto>(
      api.post(`/v1/competitions/${competitionId}/register`, body),
    );
  },
};
