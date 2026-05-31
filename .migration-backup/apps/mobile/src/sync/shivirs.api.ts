/**
 * Shivir API client (mobile) — Step 15.
 *
 * Used by the volunteer scanner screen for:
 *   - Listing shivirs the user is registered as a volunteer on.
 *   - Fetching event detail + sessions (so the scan screen knows which
 *     session to attach scans to).
 *   - Online direct-POST of a scan (used as the fast path; queued scans
 *     drain via the unified sync engine).
 */

import { api, unwrap } from '@/api/client';

export type ShivirScanKind = 'check_in' | 'check_out' | 'present';

export interface ShivirEventSummary {
  id: string;
  city_id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  attendance_mode: 'in_out' | 'present_only';
  msv_only: boolean;
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

export interface ShivirDetail {
  event: ShivirEventSummary;
  sessions: ShivirSession[];
  volunteers: Array<{ user_id: string; assigned_at: string }>;
  registration_count: number;
}

export interface ScanRequest {
  shivir_session_id: string;
  student_qr_code: string;
  client_op_id: string;
  scanned_at: string;
  force?: boolean;
  device_offline?: boolean;
}

export interface ScanResponse {
  scan_id: string;
  shivir_event_id: string;
  shivir_session_id: string;
  student_id: string;
  student_full_name: string;
  student_code: string;
  scan_kind: ShivirScanKind;
  scanned_at: string;
  attendance_mode: 'in_out' | 'present_only';
  duplicate: boolean;
}

export const shivirsApi = {
  list(): Promise<{ items: ShivirEventSummary[] }> {
    return unwrap(api.get('/v1/shivirs'));
  },
  detail(eventId: string): Promise<ShivirDetail> {
    return unwrap(api.get(`/v1/shivirs/${eventId}`));
  },
  scan(eventId: string, body: ScanRequest): Promise<ScanResponse> {
    return unwrap(api.post(`/v1/shivirs/${eventId}/scan`, body));
  },
};
