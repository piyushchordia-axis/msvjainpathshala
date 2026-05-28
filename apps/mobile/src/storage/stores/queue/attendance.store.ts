/**
 * Pending attendance marks. Full processor lands in Step 13 (Attendance);
 * Step 8 only stands up the queue so the sync engine has somewhere to drain
 * from later.
 *
 * Op payload shape is illustrative — the canonical shape lives in
 * `@jp/shared` once the attendance module ships server-side.
 */

import { QueueStore } from './_queue-base';

export interface AttendanceOpPayload {
  batch_id: string;
  session_date: string;
  student_id: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  marked_at: string;
  gps?: { lat: number; lng: number; accuracy_m: number } | null;
}

export const attendanceQueue = new QueueStore<AttendanceOpPayload>('jp.queue.attendance');
