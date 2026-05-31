/**
 * Competitions admin API wrappers (web admin) — Step 18.
 * Mirrors apps/api/src/modules/competitions/*.
 */

import { authenticatedServerClient } from './server-client';

export type CompetitionStatus = 'draft' | 'open' | 'closed' | 'results_published';

export interface CompetitionRow {
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

export interface RegistrationWithStudent {
  registration: {
    id: string;
    competition_id: string;
    student_id: string;
    registered_at: string;
    result_rank: number | null;
    result_note: string | null;
  };
  student_full_name: string;
  student_code: string;
  age_group: string;
}

export async function listAdminCompetitions(
  opts: { status?: CompetitionStatus } = {},
): Promise<{ items: CompetitionRow[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/admin/competitions', { params: opts });
  return res.data.data as { items: CompetitionRow[] };
}

export async function listAdminRegistrations(
  competitionId: string,
): Promise<{ items: RegistrationWithStudent[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get(`/v1/admin/competitions/${competitionId}/registrations`);
  return res.data.data as { items: RegistrationWithStudent[] };
}

export async function recordResults(
  competitionId: string,
  results: Array<{ student_id: string; rank: number | null; note?: string }>,
): Promise<{ recorded: number; competition: CompetitionRow }> {
  const client = await authenticatedServerClient();
  const res = await client.post(`/v1/admin/competitions/${competitionId}/results`, { results });
  return res.data.data;
}

export async function publishCompetitionResults(
  competitionId: string,
): Promise<{ competition: CompetitionRow; punya_awards: number; winners_notified: number }> {
  const client = await authenticatedServerClient();
  const res = await client.post(`/v1/admin/competitions/${competitionId}/publish-results`, {});
  return res.data.data;
}

export async function createCompetition(input: {
  name_en: string;
  name_hi: string;
  description_en?: string;
  description_hi?: string;
  eligible_age_groups?: string[];
  msv_only?: boolean;
  registration_window_start?: string;
  registration_window_end?: string;
  event_date?: string;
  winner_points?: number;
  participant_points?: number;
  max_participants?: number;
  status?: CompetitionStatus;
}): Promise<CompetitionRow> {
  const client = await authenticatedServerClient();
  const res = await client.post('/v1/admin/competitions', input);
  return res.data.data as CompetitionRow;
}
