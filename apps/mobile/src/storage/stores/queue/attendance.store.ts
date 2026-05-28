/**
 * Pending attendance marks (Step 13).
 *
 * The drain (in `features/attendance/attendance-drain.ts`) groups ops by
 * `session_id` and POSTs them as a single `/v1/attendance/mark` body. Items
 * with a null `session_id` were enqueued before the shikshak completed
 * check-in — the drain skips them; the marking screen rewrites the queue
 * with the resolved session_id once the check-in returns.
 */

import { QueueStore } from './_queue-base';

import type { AttendanceStatus } from '@jp/shared';

export interface AttendanceOpPayload {
  /** Server's session id once check-in resolves. Pre-checkin queue items
   *  may have this set to null; the drain skips them. */
  session_id: string | null;
  batch_id: string;
  scheduled_date: string;
  student_id: string;
  status: AttendanceStatus;
  notes?: string | null;
  marked_at: string;
  /** Optional GPS context for analytics; the server doesn't read it on /mark. */
  gps?: { lat: number; lng: number; accuracy_m: number } | null;
}

export const attendanceQueue = new QueueStore<AttendanceOpPayload>('jp.queue.attendance');
