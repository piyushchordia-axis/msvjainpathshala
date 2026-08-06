/**
 * Shared API error codes. Prefer these over ad-hoc strings in fail().
 * Mirrors the intended @jp/shared/errors surface for this monorepo.
 */
export const ERROR_CODES = [
  // Auth
  "ERR_UNAUTHENTICATED",
  "ERR_TOKEN_INVALID",
  "ERR_USER_INACTIVE",
  "ERR_OTP_INVALID",
  "ERR_OTP_LOCKED",
  "ERR_MAX_ATTEMPTS",
  "ERR_NO_ACCOUNT",
  "ERR_NO_REFRESH",
  "ERR_REFRESH_INVALID",
  // Access
  "ERR_FORBIDDEN",
  "ERR_WRONG_ROLE",
  "ERR_NO_IMPERSONATION",
  // General
  "ERR_NOT_FOUND",
  "ERR_VALIDATION_FAILED",
  "ERR_CONFLICT",
  "ERR_DUPLICATE",
  "ERR_ALREADY_EXISTS",
  "ERR_INTERNAL",
  "ERR_GATEWAY",
  "ERR_RATE_LIMITED",
  // Session / attendance
  "ERR_SESSION_CANCELLED",
  "ERR_SESSION_NOT_SCHEDULED",
  "ERR_ALREADY_CHECKED_IN_BY_OTHER",
  "ERR_SESSION_HAS_ATTENDANCE",
  "ERR_ATTENDANCE_EDIT_WINDOW_EXPIRED",
  "ERR_STUDENT_NOT_ENROLLED",
  // Niyam
  "ERR_NIYAM_REVERSAL_WINDOW_EXPIRED",
  "ERR_NIYAM_PERIOD_DUPLICATE",
  // Upload
  "ERR_FILE_TOO_LARGE",
  // Exam
  "ERR_EXAM_HAS_ATTEMPTS",
  "ERR_WINDOW_CLOSED",
  "ERR_ALREADY_SUBMITTED",
  "ERR_ALREADY_ATTEMPTED",
  "ERR_RESULTS_PUBLISHED",
  "ERR_NOT_OPEN",
  // Quiz
  "ERR_QUESTION_IN_USE",
  "ERR_EVENT_HAS_ATTEMPTS",
  // Enrolment / registration
  "ERR_ALREADY_APPLIED",
  "ERR_ALREADY_ENROLLED",
  "ERR_ALREADY_REGISTERED",
  "ERR_NOT_ELIGIBLE",
  // Batch
  "ERR_BATCH_CENTRE_MISMATCH",
  "ERR_BATCH_FULL",
  "ERR_BATCH_INACTIVE",
  // State / workflow
  "ERR_INVALID_STATE",
  "ERR_INVALID_TRANSITION",
  "ERR_ALREADY_PUBLISHED",
  "ERR_ORDER_MISMATCH",
  "ERR_SYNC_IN_PROGRESS",
  "ERR_SKIPPED",
  // Other domain
  "ERR_LAST_SANCHALAK",
  "ERR_FULL",
  "ERR_NOT_CENTRE_TAGGED",
  "ERR_NO_CONTENT_URL",
  "ERR_NO_PRIMARY",
  "ERR_PAYMENT_NOT_CAPTURED",
  "ERR_SIGNATURE_INVALID",
  "ERR_SMS_UNAVAILABLE",
  // Manual Punya award limits
  "ERR_AWARD_LIMIT_EXCEEDED",
  "ERR_AWARD_DAILY_LIMIT_EXCEEDED",
  // Push tokens
  "ERR_PUSH_TOKEN_CLAIMED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorCode = {
  UNAUTHENTICATED: "ERR_UNAUTHENTICATED",
  TOKEN_INVALID: "ERR_TOKEN_INVALID",
  USER_INACTIVE: "ERR_USER_INACTIVE",
  OTP_INVALID: "ERR_OTP_INVALID",
  OTP_LOCKED: "ERR_OTP_LOCKED",
  MAX_ATTEMPTS: "ERR_MAX_ATTEMPTS",
  NO_ACCOUNT: "ERR_NO_ACCOUNT",
  NO_REFRESH: "ERR_NO_REFRESH",
  REFRESH_INVALID: "ERR_REFRESH_INVALID",
  FORBIDDEN: "ERR_FORBIDDEN",
  WRONG_ROLE: "ERR_WRONG_ROLE",
  NO_IMPERSONATION: "ERR_NO_IMPERSONATION",
  NOT_FOUND: "ERR_NOT_FOUND",
  VALIDATION_FAILED: "ERR_VALIDATION_FAILED",
  CONFLICT: "ERR_CONFLICT",
  DUPLICATE: "ERR_DUPLICATE",
  ALREADY_EXISTS: "ERR_ALREADY_EXISTS",
  INTERNAL: "ERR_INTERNAL",
  GATEWAY: "ERR_GATEWAY",
  RATE_LIMITED: "ERR_RATE_LIMITED",
  SESSION_CANCELLED: "ERR_SESSION_CANCELLED",
  SESSION_NOT_SCHEDULED: "ERR_SESSION_NOT_SCHEDULED",
  ALREADY_CHECKED_IN_BY_OTHER: "ERR_ALREADY_CHECKED_IN_BY_OTHER",
  SESSION_HAS_ATTENDANCE: "ERR_SESSION_HAS_ATTENDANCE",
  ATTENDANCE_EDIT_WINDOW_EXPIRED: "ERR_ATTENDANCE_EDIT_WINDOW_EXPIRED",
  STUDENT_NOT_ENROLLED: "ERR_STUDENT_NOT_ENROLLED",
  NIYAM_REVERSAL_WINDOW_EXPIRED: "ERR_NIYAM_REVERSAL_WINDOW_EXPIRED",
  NIYAM_PERIOD_DUPLICATE: "ERR_NIYAM_PERIOD_DUPLICATE",
  FILE_TOO_LARGE: "ERR_FILE_TOO_LARGE",
  EXAM_HAS_ATTEMPTS: "ERR_EXAM_HAS_ATTEMPTS",
  WINDOW_CLOSED: "ERR_WINDOW_CLOSED",
  ALREADY_SUBMITTED: "ERR_ALREADY_SUBMITTED",
  ALREADY_ATTEMPTED: "ERR_ALREADY_ATTEMPTED",
  RESULTS_PUBLISHED: "ERR_RESULTS_PUBLISHED",
  NOT_OPEN: "ERR_NOT_OPEN",
  QUESTION_IN_USE: "ERR_QUESTION_IN_USE",
  EVENT_HAS_ATTEMPTS: "ERR_EVENT_HAS_ATTEMPTS",
  ALREADY_APPLIED: "ERR_ALREADY_APPLIED",
  ALREADY_ENROLLED: "ERR_ALREADY_ENROLLED",
  ALREADY_REGISTERED: "ERR_ALREADY_REGISTERED",
  NOT_ELIGIBLE: "ERR_NOT_ELIGIBLE",
  BATCH_CENTRE_MISMATCH: "ERR_BATCH_CENTRE_MISMATCH",
  BATCH_FULL: "ERR_BATCH_FULL",
  BATCH_INACTIVE: "ERR_BATCH_INACTIVE",
  INVALID_STATE: "ERR_INVALID_STATE",
  INVALID_TRANSITION: "ERR_INVALID_TRANSITION",
  ALREADY_PUBLISHED: "ERR_ALREADY_PUBLISHED",
  ORDER_MISMATCH: "ERR_ORDER_MISMATCH",
  SYNC_IN_PROGRESS: "ERR_SYNC_IN_PROGRESS",
  SKIPPED: "ERR_SKIPPED",
  LAST_SANCHALAK: "ERR_LAST_SANCHALAK",
  FULL: "ERR_FULL",
  NOT_CENTRE_TAGGED: "ERR_NOT_CENTRE_TAGGED",
  NO_CONTENT_URL: "ERR_NO_CONTENT_URL",
  NO_PRIMARY: "ERR_NO_PRIMARY",
  PAYMENT_NOT_CAPTURED: "ERR_PAYMENT_NOT_CAPTURED",
  SIGNATURE_INVALID: "ERR_SIGNATURE_INVALID",
  SMS_UNAVAILABLE: "ERR_SMS_UNAVAILABLE",
  AWARD_LIMIT_EXCEEDED: "ERR_AWARD_LIMIT_EXCEEDED",
  AWARD_DAILY_LIMIT_EXCEEDED: "ERR_AWARD_DAILY_LIMIT_EXCEEDED",
  PUSH_TOKEN_CLAIMED: "ERR_PUSH_TOKEN_CLAIMED",
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
  ERR_EXAM_HAS_ATTEMPTS: {
    en: "Students have already attempted this exam — editing questions now would change their scores. Clone the exam instead.",
    hi: "विद्यार्थियों ने इस परीक्षा का प्रयास पहले ही कर लिया है — अब प्रश्न बदलने से उनके अंक बदल जाएँगे। परीक्षा की कॉपी बनाएँ।",
  },
  ERR_QUESTION_IN_USE: {
    en: "This question is on a quiz that already has attempts — deactivate it and author a new question instead of editing the answer key.",
    hi: "यह प्रश्न ऐसी क्विज़ पर है जिसमें पहले से प्रयास हैं — उत्तर कुंजी बदलने के बजाय इसे निष्क्रिय करें और नया प्रश्न बनाएँ।",
  },
  ERR_EVENT_HAS_ATTEMPTS: {
    en: "This quiz event has submitted attempts — pass force: true to reverse awards and delete, or reset attempts individually.",
    hi: "इस क्विज़ इवेंट में जमा प्रयास हैं — पुरस्कार उलटने और हटाने के लिए force: true भेजें, या प्रत्येक प्रयास को अलग से रीसेट करें।",
  },
  ERR_WINDOW_CLOSED: {
    en: "The exam window is closed — you cannot start or submit now. Ask your Guruji or admin if you need another attempt.",
    hi: "परीक्षा की समय सीमा बंद हो चुकी है — अब शुरू या जमा नहीं कर सकते। यदि और प्रयास चाहिए तो गुरुजी या एडमिन से पूछें।",
  },
  ERR_OTP_INVALID: {
    en: "That exam access code is incorrect — check with your Guruji and try again.",
    hi: "परीक्षा का एक्सेस कोड गलत है — गुरुजी से पुष्टि करके फिर कोशिश करें।",
  },
  ERR_MAX_ATTEMPTS: {
    en: "You have used all attempts for this exam — ask an admin to reset if you need another try.",
    hi: "इस परीक्षा के सभी प्रयास समाप्त हो चुके हैं — यदि और प्रयास चाहिए तो एडमिन से रीसेट करवाएँ।",
  },
  ERR_ALREADY_SUBMITTED: {
    en: "This attempt was already submitted — open your results instead of submitting again.",
    hi: "यह प्रयास पहले ही जमा हो चुका है — दोबारा जमा करने के बजाय अपने परिणाम देखें।",
  },
  ERR_RATE_LIMITED: {
    en: "Too many attempts — wait a few minutes and try again.",
    hi: "बहुत अधिक प्रयास — कुछ मिनट प्रतीक्षा करें और फिर कोशिश करें।",
  },
  ERR_AWARD_LIMIT_EXCEEDED: {
    en: "That is more than you can award at once — check your per-award limit and try a smaller amount.",
    hi: "यह एक बार में दी जा सकने वाली सीमा से अधिक है — अपनी प्रति-पुरस्कार सीमा देखकर कम अंक दें।",
  },
  ERR_AWARD_DAILY_LIMIT_EXCEEDED: {
    en: "You have reached today's award limit — try again tomorrow or ask a higher role to award.",
    hi: "आज की पुरस्कार सीमा पूरी हो चुकी है — कल फिर कोशिश करें या उच्च भूमिका से पुरस्कार दिलवाएँ।",
  },
  ERR_PUSH_TOKEN_CLAIMED: {
    en: "That device is registered to another account — sign out on that device first.",
    hi: "यह डिवाइस किसी अन्य खाते से जुड़ा है — पहले उस डिवाइस पर साइन आउट करें।",
  },
} as const satisfies Partial<Record<ErrorCode, { en: string; hi: string }>>;
