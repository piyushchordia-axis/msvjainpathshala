/**
 * Canonical error-code enum for the Jain Pathshala API.
 *
 * Every API error response carries one of these codes in `error.code`. Codes
 * are stable strings (never localised) so clients can switch on them
 * exhaustively. Human-readable messages are looked up by code via `@jp/i18n`
 * — see `errors.*` keyspace in en.json / hi.json.
 *
 * Conventions:
 *   - Prefix `ERR_` so search ranks them together.
 *   - Group with a second word that names the subsystem:
 *     ERR_AUTH_*, ERR_RBAC_*, ERR_VALIDATION_*, ERR_RESOURCE_*, ERR_CONFLICT_*,
 *     ERR_RATE_*, ERR_NIYAM_*, ERR_PUNYA_*, ERR_BATCH_*, ERR_DONATION_*,
 *     ERR_MEDIA_*, ERR_SYNC_*, ERR_AI_*, ERR_INTERNAL_*.
 *
 * Sources: CLAUDE.md "API response envelope", "Critical business rules",
 *          SPEC §6.27, §7.x, §8.x.
 */

export const ERROR_CODES = {
  // ----------------------------------------------------------------------
  // Authentication (SPEC §7.1–§7.3)
  // ----------------------------------------------------------------------
  ERR_AUTH_INVALID_OTP: 'ERR_AUTH_INVALID_OTP',
  ERR_AUTH_OTP_EXPIRED: 'ERR_AUTH_OTP_EXPIRED',
  ERR_AUTH_OTP_MAX_ATTEMPTS: 'ERR_AUTH_OTP_MAX_ATTEMPTS',
  ERR_AUTH_PHONE_INVALID: 'ERR_AUTH_PHONE_INVALID',
  ERR_AUTH_USER_NOT_FOUND: 'ERR_AUTH_USER_NOT_FOUND',
  ERR_AUTH_TOKEN_INVALID: 'ERR_AUTH_TOKEN_INVALID',
  ERR_AUTH_TOKEN_EXPIRED: 'ERR_AUTH_TOKEN_EXPIRED',
  ERR_AUTH_REFRESH_REUSE_DETECTED: 'ERR_AUTH_REFRESH_REUSE_DETECTED',
  ERR_AUTH_SESSION_LIMIT_REACHED: 'ERR_AUTH_SESSION_LIMIT_REACHED',
  ERR_AUTH_STUDENT_VIEW_UNDERAGE: 'ERR_AUTH_STUDENT_VIEW_UNDERAGE', // CLAUDE.md Q4
  ERR_AUTH_STUDENT_VIEW_DISABLED: 'ERR_AUTH_STUDENT_VIEW_DISABLED',
  ERR_AUTH_IMPERSONATION_DENIED: 'ERR_AUTH_IMPERSONATION_DENIED',

  // ----------------------------------------------------------------------
  // RBAC / scoping (SPEC §7.6–§7.8)
  // ----------------------------------------------------------------------
  ERR_RBAC_FORBIDDEN: 'ERR_RBAC_FORBIDDEN',
  ERR_RBAC_OUT_OF_SCOPE: 'ERR_RBAC_OUT_OF_SCOPE',
  ERR_RBAC_FORBIDDEN_MSV_CURRICULUM: 'ERR_RBAC_FORBIDDEN_MSV_CURRICULUM', // CLAUDE.md Q2

  // ----------------------------------------------------------------------
  // Validation (SPEC §6.27)
  // ----------------------------------------------------------------------
  ERR_VALIDATION_FAILED: 'ERR_VALIDATION_FAILED',
  ERR_VALIDATION_BILINGUAL_REQUIRED: 'ERR_VALIDATION_BILINGUAL_REQUIRED',
  ERR_VALIDATION_PHONE_FORMAT: 'ERR_VALIDATION_PHONE_FORMAT',
  ERR_VALIDATION_UUID_FORMAT: 'ERR_VALIDATION_UUID_FORMAT',
  ERR_VALIDATION_DATETIME_FORMAT: 'ERR_VALIDATION_DATETIME_FORMAT',
  ERR_VALIDATION_EMBED_URL_INVALID: 'ERR_VALIDATION_EMBED_URL_INVALID', // CLAUDE.md Q7

  // ----------------------------------------------------------------------
  // Resource lifecycle
  // ----------------------------------------------------------------------
  ERR_RESOURCE_NOT_FOUND: 'ERR_RESOURCE_NOT_FOUND',
  ERR_RESOURCE_DELETED: 'ERR_RESOURCE_DELETED',
  ERR_RESOURCE_INACTIVE: 'ERR_RESOURCE_INACTIVE',

  // ----------------------------------------------------------------------
  // Conflicts
  // ----------------------------------------------------------------------
  ERR_CONFLICT: 'ERR_CONFLICT',
  ERR_CONFLICT_STATE_TRANSITION: 'ERR_CONFLICT_STATE_TRANSITION',
  ERR_DUPLICATE_RESOURCE: 'ERR_DUPLICATE_RESOURCE',
  ERR_DUPLICATE_STUDENT: 'ERR_DUPLICATE_STUDENT',

  // ----------------------------------------------------------------------
  // Rate limiting
  // ----------------------------------------------------------------------
  ERR_RATE_LIMITED: 'ERR_RATE_LIMITED',

  // ----------------------------------------------------------------------
  // Domain — Niyams (CLAUDE.md Q5)
  // ----------------------------------------------------------------------
  ERR_NIYAM_REVERSAL_WINDOW_EXPIRED: 'ERR_NIYAM_REVERSAL_WINDOW_EXPIRED',
  ERR_NIYAM_SUBMISSION_LOCKED: 'ERR_NIYAM_SUBMISSION_LOCKED',
  ERR_NIYAM_PROOF_REQUIRED: 'ERR_NIYAM_PROOF_REQUIRED',

  // ----------------------------------------------------------------------
  // Domain — Punya (SPEC §8.5)
  // ----------------------------------------------------------------------
  ERR_PUNYA_REVERSAL_WINDOW_EXPIRED: 'ERR_PUNYA_REVERSAL_WINDOW_EXPIRED',
  ERR_PUNYA_IDEMPOTENCY_REQUIRED: 'ERR_PUNYA_IDEMPOTENCY_REQUIRED',
  ERR_PUNYA_INVALID_FEATURE: 'ERR_PUNYA_INVALID_FEATURE',
  /** Manual-award amount fell outside the catalogue / city-override bounds. */
  ERR_PUNYA_AMOUNT_OUT_OF_BOUNDS: 'ERR_PUNYA_AMOUNT_OUT_OF_BOUNDS',
  /** Reversal target txn was already reversed (`reversal_of IS NOT NULL`). */
  ERR_PUNYA_ALREADY_REVERSED: 'ERR_PUNYA_ALREADY_REVERSED',
  /** Reversal targets a row that does not exist. */
  ERR_PUNYA_TRANSACTION_NOT_FOUND: 'ERR_PUNYA_TRANSACTION_NOT_FOUND',
  /** Manual award without a reason when the feature requires one. */
  ERR_PUNYA_REASON_REQUIRED: 'ERR_PUNYA_REASON_REQUIRED',
  /** Per-city override exceeds the super_admin-set bounds on the feature. */
  ERR_PUNYA_CONFIG_OUT_OF_BOUNDS: 'ERR_PUNYA_CONFIG_OUT_OF_BOUNDS',

  // ----------------------------------------------------------------------
  // Domain — Batches & enrolment
  // ----------------------------------------------------------------------
  ERR_BATCH_OVER_CAPACITY: 'ERR_BATCH_OVER_CAPACITY',
  ERR_BATCH_SHIKSHAK_REQUIRED: 'ERR_BATCH_SHIKSHAK_REQUIRED',
  ERR_ENROLMENT_ALREADY_DECIDED: 'ERR_ENROLMENT_ALREADY_DECIDED',

  // ----------------------------------------------------------------------
  // Domain — Attendance (SPEC §8.2, §8.3)
  // ----------------------------------------------------------------------
  ERR_ATTENDANCE_SESSION_NOT_OPEN: 'ERR_ATTENDANCE_SESSION_NOT_OPEN',
  ERR_ATTENDANCE_SESSION_CANCELLED: 'ERR_ATTENDANCE_SESSION_CANCELLED',
  ERR_ATTENDANCE_OUT_OF_GPS_RANGE: 'ERR_ATTENDANCE_OUT_OF_GPS_RANGE',
  ERR_ATTENDANCE_ALREADY_MARKED: 'ERR_ATTENDANCE_ALREADY_MARKED',
  ERR_ATTENDANCE_STUDENT_NOT_IN_BATCH: 'ERR_ATTENDANCE_STUDENT_NOT_IN_BATCH',
  ERR_ATTENDANCE_GPS_ACCURACY_TOO_LOW: 'ERR_ATTENDANCE_GPS_ACCURACY_TOO_LOW',
  ERR_SESSION_NOT_FOUND: 'ERR_SESSION_NOT_FOUND',
  ERR_SESSION_ALREADY_CHECKED_IN: 'ERR_SESSION_ALREADY_CHECKED_IN',
  ERR_SESSION_NOT_IN_PROGRESS: 'ERR_SESSION_NOT_IN_PROGRESS',
  ERR_SESSION_NOT_ASSIGNED_TO_SHIKSHAK: 'ERR_SESSION_NOT_ASSIGNED_TO_SHIKSHAK',
  ERR_ABSENCE_NOT_OWN_CHILD: 'ERR_ABSENCE_NOT_OWN_CHILD',

  // ----------------------------------------------------------------------
  // Domain — Shivirs (SPEC §8.6)
  // ----------------------------------------------------------------------
  ERR_SHIVIR_SCAN_OUT_OF_ORDER: 'ERR_SHIVIR_SCAN_OUT_OF_ORDER',
  ERR_SHIVIR_PARTICIPANT_NOT_FOUND: 'ERR_SHIVIR_PARTICIPANT_NOT_FOUND',
  ERR_SHIVIR_NOT_REGISTERED: 'ERR_SHIVIR_NOT_REGISTERED',
  ERR_SHIVIR_SCAN_DUPLICATE_PRESENT: 'ERR_SHIVIR_SCAN_DUPLICATE_PRESENT',
  ERR_SHIVIR_QR_INVALID: 'ERR_SHIVIR_QR_INVALID',
  ERR_SHIVIR_VOLUNTEER_NOT_ASSIGNED: 'ERR_SHIVIR_VOLUNTEER_NOT_ASSIGNED',

  // ----------------------------------------------------------------------
  // Domain — Exams (SPEC §8.9)
  // ----------------------------------------------------------------------
  ERR_EXAM_OTP_INVALID: 'ERR_EXAM_OTP_INVALID',
  ERR_EXAM_WINDOW_CLOSED: 'ERR_EXAM_WINDOW_CLOSED',

  // ----------------------------------------------------------------------
  // Domain — Donations (CLAUDE.md Q3, SPEC §8.8)
  // ----------------------------------------------------------------------
  ERR_DONATION_80G_DISABLED: 'ERR_DONATION_80G_DISABLED',
  ERR_DONATION_80G_PREREQS_MISSING: 'ERR_DONATION_80G_PREREQS_MISSING',
  ERR_DONATION_WEBHOOK_SIGNATURE: 'ERR_DONATION_WEBHOOK_SIGNATURE',

  // ----------------------------------------------------------------------
  // Domain — Media
  // ----------------------------------------------------------------------
  ERR_MEDIA_UPLOAD_FAILED: 'ERR_MEDIA_UPLOAD_FAILED',
  ERR_MEDIA_QUARANTINED: 'ERR_MEDIA_QUARANTINED',
  ERR_MEDIA_TOO_LARGE: 'ERR_MEDIA_TOO_LARGE',
  ERR_MEDIA_UNSUPPORTED_TYPE: 'ERR_MEDIA_UNSUPPORTED_TYPE',

  // ----------------------------------------------------------------------
  // Domain — Sync (offline)
  // ----------------------------------------------------------------------
  ERR_SYNC_DUPLICATE_OP: 'ERR_SYNC_DUPLICATE_OP',
  ERR_SYNC_UNKNOWN_OP_KIND: 'ERR_SYNC_UNKNOWN_OP_KIND',
  ERR_SYNC_DEAD_LETTERED: 'ERR_SYNC_DEAD_LETTERED',
  ERR_SYNC_CONFLICT: 'ERR_SYNC_CONFLICT',
  ERR_SYNC_VALIDATION_FAILED: 'ERR_SYNC_VALIDATION_FAILED',

  // ----------------------------------------------------------------------
  // Domain — Gallery (CLAUDE.md Q6)
  // ----------------------------------------------------------------------
  ERR_GALLERY_OPT_OUT_ACTIVE: 'ERR_GALLERY_OPT_OUT_ACTIVE',

  // ----------------------------------------------------------------------
  // Domain — Homework (SPEC §5.9, §6.12)
  // ----------------------------------------------------------------------
  ERR_HOMEWORK_NOT_FOUND: 'ERR_HOMEWORK_NOT_FOUND',
  ERR_HOMEWORK_ALREADY_GRADED: 'ERR_HOMEWORK_ALREADY_GRADED',
  ERR_HOMEWORK_STUDENT_NOT_IN_BATCH: 'ERR_HOMEWORK_STUDENT_NOT_IN_BATCH',
  ERR_HOMEWORK_SUBMISSION_NOT_FOUND: 'ERR_HOMEWORK_SUBMISSION_NOT_FOUND',

  // ----------------------------------------------------------------------
  // Domain — Notices (SPEC §5.10, §6.13, §8.7)
  // ----------------------------------------------------------------------
  ERR_NOTICE_NOT_FOUND: 'ERR_NOTICE_NOT_FOUND',
  ERR_NOTICE_NOT_PUBLISHED: 'ERR_NOTICE_NOT_PUBLISHED',
  ERR_NOTICE_SMS_CAP_EXCEEDED: 'ERR_NOTICE_SMS_CAP_EXCEEDED',
  ERR_NOTICE_SCHEDULED_IN_PAST: 'ERR_NOTICE_SCHEDULED_IN_PAST',

  // ----------------------------------------------------------------------
  // Domain — Competitions (SPEC §5.12, §6.15)
  // ----------------------------------------------------------------------
  ERR_COMPETITION_NOT_FOUND: 'ERR_COMPETITION_NOT_FOUND',
  ERR_COMPETITION_REGISTRATION_CLOSED: 'ERR_COMPETITION_REGISTRATION_CLOSED',
  ERR_COMPETITION_FULL: 'ERR_COMPETITION_FULL',
  ERR_COMPETITION_NOT_ELIGIBLE: 'ERR_COMPETITION_NOT_ELIGIBLE',
  ERR_COMPETITION_RESULTS_ALREADY_PUBLISHED: 'ERR_COMPETITION_RESULTS_ALREADY_PUBLISHED',
  ERR_COMPETITION_RESULTS_NOT_ENTERED: 'ERR_COMPETITION_RESULTS_NOT_ENTERED',
  ERR_COMPETITION_ALREADY_REGISTERED: 'ERR_COMPETITION_ALREADY_REGISTERED',

  // ----------------------------------------------------------------------
  // AI service (SPEC §3.5)
  // ----------------------------------------------------------------------
  ERR_AI_UNAVAILABLE: 'ERR_AI_UNAVAILABLE',
  ERR_AI_MODERATION_FLAGGED: 'ERR_AI_MODERATION_FLAGGED',

  // ----------------------------------------------------------------------
  // Internal
  // ----------------------------------------------------------------------
  ERR_INTERNAL: 'ERR_INTERNAL',
  ERR_NOT_IMPLEMENTED: 'ERR_NOT_IMPLEMENTED',
} as const;

export type ErrorCodeKey = keyof typeof ERROR_CODES;
export type ErrorCode = (typeof ERROR_CODES)[ErrorCodeKey];
