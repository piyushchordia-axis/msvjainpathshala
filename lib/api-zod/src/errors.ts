/**
 * Shared API error codes. Prefer these over ad-hoc strings in fail().
 * Mirrors the intended @jp/shared/errors surface for this monorepo.
 */
export const ERROR_CODES = [
  "ERR_UNAUTHENTICATED",
  "ERR_TOKEN_INVALID",
  "ERR_USER_INACTIVE",
  "ERR_FORBIDDEN",
  "ERR_NOT_FOUND",
  "ERR_VALIDATION_FAILED",
  "ERR_CONFLICT",
  "ERR_SESSION_CANCELLED",
  "ERR_SESSION_NOT_SCHEDULED",
  "ERR_ALREADY_CHECKED_IN_BY_OTHER",
  "ERR_SESSION_HAS_ATTENDANCE",
  "ERR_ATTENDANCE_EDIT_WINDOW_EXPIRED",
  "ERR_STUDENT_NOT_ENROLLED",
  "ERR_NIYAM_REVERSAL_WINDOW_EXPIRED",
  "ERR_FILE_TOO_LARGE",
  "ERR_RATE_LIMITED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorCode = {
  UNAUTHENTICATED: "ERR_UNAUTHENTICATED",
  TOKEN_INVALID: "ERR_TOKEN_INVALID",
  USER_INACTIVE: "ERR_USER_INACTIVE",
  FORBIDDEN: "ERR_FORBIDDEN",
  NOT_FOUND: "ERR_NOT_FOUND",
  VALIDATION_FAILED: "ERR_VALIDATION_FAILED",
  CONFLICT: "ERR_CONFLICT",
  SESSION_CANCELLED: "ERR_SESSION_CANCELLED",
  SESSION_NOT_SCHEDULED: "ERR_SESSION_NOT_SCHEDULED",
  ALREADY_CHECKED_IN_BY_OTHER: "ERR_ALREADY_CHECKED_IN_BY_OTHER",
  SESSION_HAS_ATTENDANCE: "ERR_SESSION_HAS_ATTENDANCE",
  ATTENDANCE_EDIT_WINDOW_EXPIRED: "ERR_ATTENDANCE_EDIT_WINDOW_EXPIRED",
  STUDENT_NOT_ENROLLED: "ERR_STUDENT_NOT_ENROLLED",
  NIYAM_REVERSAL_WINDOW_EXPIRED: "ERR_NIYAM_REVERSAL_WINDOW_EXPIRED",
  FILE_TOO_LARGE: "ERR_FILE_TOO_LARGE",
  RATE_LIMITED: "ERR_RATE_LIMITED",
} as const satisfies Record<string, ErrorCode>;

/** Server + client upload size cap (multer + pre-upload guard). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Bilingual copy for known error codes.
 * Voice: state the problem AND the fix (see error-voice rule).
 */
export const ERROR_MESSAGES = {
  ERR_FILE_TOO_LARGE: {
    en: "That video is too large (max 50 MB). Record a shorter clip and try again.",
    hi: "यह वीडियो बहुत बड़ा है (अधिकतम 50 MB)। छोटा क्लिप रिकॉर्ड करके फिर कोशिश करें।",
  },
} as const satisfies Partial<Record<ErrorCode, { en: string; hi: string }>>;
