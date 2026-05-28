/**
 * `attendance_status_enum` and `session_status_enum` (SPEC §5.1).
 *
 * Late vs absent distinction (SPEC §8.3): shikshak marks `late` if the student
 * arrived after the GPS check-in window closed but during the session.
 */

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const SESSION_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
