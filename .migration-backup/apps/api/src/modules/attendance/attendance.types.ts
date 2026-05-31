/**
 * Attendance module types shared between controller / service / processor.
 */

import type { AttendanceStatus } from '@jp/shared';

export interface MarkItemInput {
  student_id: string;
  status: AttendanceStatus;
  notes?: string | null;
  /** Per-item idempotency key (offline sync). */
  client_op_id: string;
}

export interface MarkResultItem {
  student_id: string;
  attendance_id: string;
  status: AttendanceStatus;
  prior_status: AttendanceStatus | null;
  punya_awarded: number;
  notes?: string | null;
}

/** Payload of an attendance.post_process job. */
export interface AttendancePostProcessPayload {
  session_id: string;
  batch_id: string;
  centre_id: string;
  city_id: string;
  marked_by_user_id: string;
  marks: Array<{
    student_id: string;
    attendance_id: string;
    status: AttendanceStatus;
    prior_status: AttendanceStatus | null;
  }>;
}
