/**
 * Thin axios wrappers for the attendance + sessions endpoints (Step 13).
 *
 * All functions return the unwrapped `data` payload, so the call sites read
 * cleanly:
 *
 *   const { items, date } = await attendanceApi.today();
 */

import { api, unwrap } from '@/api/client';

import type { AttendanceStatus } from '@jp/shared';

export interface TodayRow {
  batch_id: string;
  batch_name: string;
  centre_id: string;
  centre_name: string;
  start_time: string;
  end_time: string;
  session_id: string | null;
  session_status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | null;
  check_in_at: string | null;
}

export interface SessionRow {
  id: string;
  batch_id: string;
  scheduled_date: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  shikshak_user_id: string | null;
  check_in_at: string | null;
  check_in_distance_m: number | null;
  gps_haversine_m: number | null;
  check_out_at: string | null;
  duration_minutes: number | null;
  cancellation_reason: string | null;
}

export interface RosterStudent {
  id: string;
  full_name: string;
  student_code: string;
  pre_excused: boolean;
  absence_reason: string | null;
  attendance: { id: string; status: AttendanceStatus; notes: string | null } | null;
}

export interface MarkItem {
  student_id: string;
  status: AttendanceStatus;
  notes?: string;
  client_op_id: string;
}

export interface MarkResult {
  items: Array<{
    student_id: string;
    attendance_id: string;
    status: AttendanceStatus;
    prior_status: AttendanceStatus | null;
    punya_awarded: number;
    notes?: string | null;
  }>;
  session: SessionRow;
}

export const attendanceApi = {
  today(): Promise<{ items: TodayRow[]; date: string }> {
    return unwrap(api.get('/v1/sessions/today'));
  },

  checkInByBatch(payload: {
    batch_id: string;
    lat: number;
    lng: number;
    accuracy_m: number;
    client_op_id: string;
  }): Promise<{ session: SessionRow }> {
    return unwrap(api.post('/v1/sessions/check-in', payload));
  },

  checkInById(
    sessionId: string,
    payload: { lat: number; lng: number; accuracy_m: number; client_op_id: string },
  ): Promise<{ session: SessionRow }> {
    return unwrap(api.post(`/v1/sessions/${sessionId}/check-in`, payload));
  },

  checkOut(
    sessionId: string,
    payload: { lat: number; lng: number; client_op_id: string },
  ): Promise<{ session: SessionRow }> {
    return unwrap(api.post(`/v1/sessions/${sessionId}/check-out`, payload));
  },

  cancel(sessionId: string, reason: string): Promise<{ session: SessionRow }> {
    return unwrap(api.post(`/v1/sessions/${sessionId}/cancel`, { reason }));
  },

  roster(sessionId: string): Promise<{ session: SessionRow; students: RosterStudent[] }> {
    return unwrap(api.get(`/v1/sessions/${sessionId}/roster`));
  },

  mark(payload: { session_id: string; marks: MarkItem[] }): Promise<MarkResult> {
    return unwrap(api.post('/v1/attendance/mark', payload));
  },

  studentMonth(
    studentId: string,
    month: string,
  ): Promise<{
    items: Array<{ attendance: { status: AttendanceStatus }; scheduled_date: string }>;
    absences: Array<{ date: string; reason: string | null }>;
  }> {
    return unwrap(api.get(`/v1/students/${studentId}/attendance`, { params: { month } }));
  },

  notifyAbsence(payload: {
    student_id: string;
    date: string;
    reason: string;
  }): Promise<{ absence_notification: { id: string; expected_date: string } }> {
    return unwrap(api.post('/v1/absences/notify', payload));
  },
};
