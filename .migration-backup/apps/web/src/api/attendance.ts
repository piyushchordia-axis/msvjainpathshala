/**
 * Attendance API wrappers — server-side, used by the admin pages.
 * Reads the access cookie automatically via `authenticatedServerClient`.
 */

import { authenticatedServerClient } from './server-client';

export interface AdminSession {
  id: string;
  batch_id: string;
  scheduled_date: string;
  scheduled_start_time: string;
  scheduled_end_time: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  shikshak_user_id: string | null;
  check_in_at: string | null;
  check_in_distance_m: number | null;
  gps_haversine_m: number | null;
  check_out_at: string | null;
  duration_minutes: number | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
}

export interface AdminCentreLogItem {
  session: AdminSession;
  batch_name: string;
  gps_radius_m: number;
  counts: { present: number; absent: number; late: number; excused: number };
}

export async function listCentreAttendanceLog(
  centreId: string,
  opts: { from?: string; to?: string } = {},
): Promise<{ items: AdminCentreLogItem[] }> {
  const client = await authenticatedServerClient();
  const params: Record<string, string> = {};
  if (opts.from) params.from = opts.from;
  if (opts.to) params.to = opts.to;
  const res = await client.get(`/v1/admin/attendance/centres/${centreId}/log`, { params });
  return res.data.data as { items: AdminCentreLogItem[] };
}

export async function listSessions(opts: {
  batch_id?: string;
  from?: string;
  to?: string;
}): Promise<{ items: AdminSession[] }> {
  const client = await authenticatedServerClient();
  const params: Record<string, string> = {};
  if (opts.batch_id) params.batch_id = opts.batch_id;
  if (opts.from) params.from = opts.from;
  if (opts.to) params.to = opts.to;
  const res = await client.get('/v1/sessions', { params });
  return res.data.data as { items: AdminSession[] };
}

export interface AdminRosterStudent {
  id: string;
  full_name: string;
  student_code: string;
  pre_excused: boolean;
  absence_reason: string | null;
  attendance: {
    id: string;
    status: 'present' | 'absent' | 'late' | 'excused';
    notes: string | null;
  } | null;
}

export async function getSessionRoster(
  sessionId: string,
): Promise<{ session: AdminSession; students: AdminRosterStudent[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get(`/v1/sessions/${sessionId}/roster`);
  return res.data.data as { session: AdminSession; students: AdminRosterStudent[] };
}
