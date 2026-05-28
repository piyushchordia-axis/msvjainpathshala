/**
 * All PostgreSQL enums from SPEC §5.1 — declared once, imported everywhere.
 *
 * Values are sourced from the `@jp/shared` const arrays so the API and the
 * client packages never drift. If you add a value here, also add it to the
 * matching const in `packages/shared/src/enums/`.
 *
 * Naming convention: `{name}Enum` is the Drizzle pgEnum; the value array
 * comes from `@jp/shared` under the matching SCREAMING_SNAKE_CASE const.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

import {
  AGE_GROUPS,
  ATTENDANCE_STATUSES,
  AUDIT_ACTIONS,
  CURRICULUM_LEVELS,
  DONATION_FREQUENCIES,
  DONATION_PURPOSES,
  ENROLMENT_STATUSES,
  EXAM_QUESTION_TYPES,
  GENDERS,
  HOMEWORK_STATUSES,
  LANGUAGES,
  LIBRARY_ACCESS_TIERS,
  LIBRARY_CONTENT_TYPES,
  MEDIA_KINDS,
  MEDIA_STATUSES,
  MSV_STATUSES,
  NIYAM_SUBMISSION_STATUSES,
  NIYAM_TYPES,
  NOTICE_AUDIENCES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  PAYMENT_STATUSES,
  PROOF_TYPES,
  QUIZ_SCOPES,
  ROLES,
  SERVICE_REQUEST_STATUSES,
  SESSION_STATUSES,
  SHIVIR_ATTENDANCE_MODES,
  SHIVIR_SCAN_KINDS,
  STUDENT_STATUSES,
  SYNC_OP_STATUSES,
  TIERS,
} from '@jp/shared';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
export const roleEnum = pgEnum('role_enum', ROLES);
export const genderEnum = pgEnum('gender_enum', GENDERS);
export const languageEnum = pgEnum('language_enum', LANGUAGES);
export const ageGroupEnum = pgEnum('age_group_enum', AGE_GROUPS);

// ---------------------------------------------------------------------------
// Attendance / sessions
// ---------------------------------------------------------------------------
export const attendanceStatusEnum = pgEnum('attendance_status_enum', ATTENDANCE_STATUSES);
export const sessionStatusEnum = pgEnum('session_status_enum', SESSION_STATUSES);

// ---------------------------------------------------------------------------
// Students / enrolment / MSV
// ---------------------------------------------------------------------------
export const studentStatusEnum = pgEnum('student_status_enum', STUDENT_STATUSES);
export const enrolmentStatusEnum = pgEnum('enrolment_status_enum', ENROLMENT_STATUSES);
export const msvStatusEnum = pgEnum('msv_status_enum', MSV_STATUSES);

// ---------------------------------------------------------------------------
// Punya
// ---------------------------------------------------------------------------
export const tierEnum = pgEnum('tier_enum', TIERS);

// ---------------------------------------------------------------------------
// Niyams
// ---------------------------------------------------------------------------
export const niyamTypeEnum = pgEnum('niyam_type_enum', NIYAM_TYPES);
export const proofTypeEnum = pgEnum('proof_type_enum', PROOF_TYPES);
export const niyamSubmissionStatusEnum = pgEnum(
  'niyam_submission_status_enum',
  NIYAM_SUBMISSION_STATUSES,
);

// ---------------------------------------------------------------------------
// Homework
// ---------------------------------------------------------------------------
export const homeworkStatusEnum = pgEnum('homework_status_enum', HOMEWORK_STATUSES);

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------
export const noticeAudienceEnum = pgEnum('notice_audience_enum', NOTICE_AUDIENCES);

// ---------------------------------------------------------------------------
// Service requests
// ---------------------------------------------------------------------------
export const serviceRequestStatusEnum = pgEnum(
  'service_request_status_enum',
  SERVICE_REQUEST_STATUSES,
);

// ---------------------------------------------------------------------------
// Curriculum
// ---------------------------------------------------------------------------
export const curriculumLevelEnum = pgEnum('curriculum_level_enum', CURRICULUM_LEVELS);

// ---------------------------------------------------------------------------
// Shivirs
// ---------------------------------------------------------------------------
export const shivirAttendanceModeEnum = pgEnum(
  'shivir_attendance_mode_enum',
  SHIVIR_ATTENDANCE_MODES,
);
export const shivirScanKindEnum = pgEnum('shivir_scan_kind_enum', SHIVIR_SCAN_KINDS);

// ---------------------------------------------------------------------------
// Exams / quizzes
// ---------------------------------------------------------------------------
export const examQuestionTypeEnum = pgEnum('exam_question_type_enum', EXAM_QUESTION_TYPES);
export const quizScopeEnum = pgEnum('quiz_scope_enum', QUIZ_SCOPES);

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------
export const libraryContentTypeEnum = pgEnum('library_content_type_enum', LIBRARY_CONTENT_TYPES);
export const libraryAccessTierEnum = pgEnum('library_access_tier_enum', LIBRARY_ACCESS_TIERS);

// ---------------------------------------------------------------------------
// Donations
// ---------------------------------------------------------------------------
export const donationPurposeEnum = pgEnum('donation_purpose_enum', DONATION_PURPOSES);
export const donationFrequencyEnum = pgEnum('donation_frequency_enum', DONATION_FREQUENCIES);
export const paymentStatusEnum = pgEnum('payment_status_enum', PAYMENT_STATUSES);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export const notificationChannelEnum = pgEnum('notification_channel_enum', NOTIFICATION_CHANNELS);
export const notificationStatusEnum = pgEnum('notification_status_enum', NOTIFICATION_STATUSES);

// ---------------------------------------------------------------------------
// Audit / sync / media
// ---------------------------------------------------------------------------
export const auditActionEnum = pgEnum('audit_action_enum', AUDIT_ACTIONS);
export const mediaKindEnum = pgEnum('media_kind_enum', MEDIA_KINDS);
export const mediaStatusEnum = pgEnum('media_status_enum', MEDIA_STATUSES);
export const syncOpStatusEnum = pgEnum('sync_op_status_enum', SYNC_OP_STATUSES);
