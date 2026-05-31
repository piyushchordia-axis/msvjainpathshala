/**
 * Shivirs module — shared types (SPEC §5.11, §6.14, §8.6).
 */

import type { ShivirAttendanceMode, ShivirScanKind } from '@jp/shared';

/**
 * Input for `POST /v1/shivirs/:id/scan` and for the sync handler.
 *
 * `student_qr_code` accepts the decoded value the camera spat out. The
 * service resolves it to a student_id via (in order):
 *   1. UUID match against `students.id` (used in tests + dev fixtures)
 *   2. Exact match against `digital_id_cards.qr_payload` (Step 11 cards)
 */
export interface ShivirScanInput {
  shivir_session_id: string;
  student_qr_code: string;
  client_op_id: string;
  scanned_at: string; // ISO-8601
  /** Volunteer override of an in_out conflict (e.g. parent's twin scanned twice). */
  force?: boolean;
  device_offline?: boolean;
}

export interface ShivirScanResult {
  scan_id: string;
  shivir_event_id: string;
  shivir_session_id: string;
  student_id: string;
  student_full_name: string;
  student_code: string;
  scan_kind: ShivirScanKind;
  scanned_at: string;
  attendance_mode: ShivirAttendanceMode;
  duplicate: boolean;
}
