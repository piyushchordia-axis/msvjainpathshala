/**
 * `enrolment_status_enum`, `student_status_enum`, `msv_status_enum` (SPEC §5.1).
 *
 * Soft-delete rule (CLAUDE.md Q11): students are deactivated (`status='inactive'`),
 * never DELETEd. Re-activation must be possible at any time.
 *
 * MSV admin discretion (CLAUDE.md Q1): no eligibility validation is performed.
 * The state machine is purely admin-driven.
 */

export const ENROLMENT_STATUSES = ['pending', 'approved', 'rejected', 'waitlisted'] as const;
export type EnrolmentStatus = (typeof ENROLMENT_STATUSES)[number];

export const STUDENT_STATUSES = ['active', 'inactive'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const MSV_STATUSES = [
  'none',
  'applied',
  'waitlisted',
  'approved',
  'rejected',
  'revoked',
] as const;
export type MsvStatus = (typeof MSV_STATUSES)[number];
