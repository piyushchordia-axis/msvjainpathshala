/**
 * Shivirs API wrappers (web admin) — Step 15.
 */

import { authenticatedServerClient } from './server-client';

export type ShivirAttendanceMode = 'in_out' | 'present_only';
export type ShivirScanKind = 'check_in' | 'check_out' | 'present';

export interface ShivirEventSummary {
  id: string;
  city_id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  location_text: string | null;
  capacity: number | null;
  msv_only: boolean;
  attendance_mode: ShivirAttendanceMode;
  sessions_count: number;
}

export interface ShivirSession {
  id: string;
  shivir_event_id: string;
  day_number: number;
  session_date: string;
  start_time: string;
  end_time: string;
}

export interface ShivirVolunteer {
  user_id: string;
  assigned_at: string;
}

export interface ShivirDetail {
  event: ShivirEventSummary;
  sessions: ShivirSession[];
  volunteers: ShivirVolunteer[];
  registration_count: number;
}

export interface ShivirLiveCounters {
  registered: number;
  currently_in: number;
  already_out: number;
  not_arrived: number;
}

export interface ShivirRecentScan {
  id: string;
  student_id: string;
  student_full_name: string;
  student_code: string;
  scan_kind: ShivirScanKind;
  scanned_at: string;
}

export interface ShivirLiveResponse {
  event: ShivirEventSummary;
  counters: ShivirLiveCounters;
  recent_scans: ShivirRecentScan[];
}

export async function listShivirs(): Promise<{ items: ShivirEventSummary[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/shivirs');
  return res.data.data as { items: ShivirEventSummary[] };
}

export async function getShivir(eventId: string): Promise<ShivirDetail> {
  const client = await authenticatedServerClient();
  const res = await client.get(`/v1/shivirs/${eventId}`);
  return res.data.data as ShivirDetail;
}

export async function getShivirLive(
  eventId: string,
  opts: { session_id?: string } = {},
): Promise<ShivirLiveResponse> {
  const client = await authenticatedServerClient();
  const params: Record<string, string> = {};
  if (opts.session_id) params.session_id = opts.session_id;
  const res = await client.get(`/v1/admin/shivirs/${eventId}/live`, { params });
  return res.data.data as ShivirLiveResponse;
}
