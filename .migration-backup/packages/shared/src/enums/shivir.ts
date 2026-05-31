/**
 * `shivir_attendance_mode_enum` and `shivir_scan_kind_enum` (SPEC §5.1).
 *
 * - `in_out` shivirs require a check-in AND a check-out scan per participant.
 * - `present_only` shivirs accept a single `present` scan per participant.
 * See SPEC §8.6 for the scan-state machine and §9.4 for the realtime
 * `scan.added` / `dashboard.updated` events.
 */

export const SHIVIR_ATTENDANCE_MODES = ['in_out', 'present_only'] as const;
export type ShivirAttendanceMode = (typeof SHIVIR_ATTENDANCE_MODES)[number];

export const SHIVIR_SCAN_KINDS = ['check_in', 'check_out', 'present'] as const;
export type ShivirScanKind = (typeof SHIVIR_SCAN_KINDS)[number];
