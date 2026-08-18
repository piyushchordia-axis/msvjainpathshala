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
  // Translation (notice composition assist)
  "ERR_TRANSLATION_UNAVAILABLE",
  "ERR_TRANSLATION_FAILED",
  // Manual Punya award limits
  "ERR_AWARD_LIMIT_EXCEEDED",
  "ERR_AWARD_DAILY_LIMIT_EXCEEDED",
  // Push tokens
  "ERR_PUSH_TOKEN_CLAIMED",
  // Course progress / certification (CU32)
  "ERR_COURSE_NODE_CERTIFIED",
  "ERR_COURSE_NODE_NOT_COMPLETE",
  "ERR_COURSE_NODE_HAS_CERTIFICATIONS",
  "ERR_COURSE_NODE_NOT_FOUND",
  "ERR_COURSE_STUDENT_OUT_OF_SCOPE",
  "ERR_COURSE_NOT_PUBLISHABLE",
  // Library — content requests + PDF (Section 17 v3)
  "ERR_LIBRARY_REQUEST_RATE_LIMITED",
  "ERR_LIBRARY_REQUEST_PENDING_LIMIT",
  "ERR_LIBRARY_REQUEST_ACTION_FORBIDDEN",
  "ERR_LIBRARY_PDF_TOO_LARGE",
  // Geography
  "ERR_CITY_SLUG_CONFLICT",
  // Team directory
  "ERR_TEAM_PUBLISH_FORBIDDEN",
  "ERR_TEAM_SCOPE_INVALID",
  "ERR_TEAM_DESIGNATION_REQUIRED",
  "ERR_TEAM_MEMBER_DUPLICATE",
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
  TRANSLATION_UNAVAILABLE: "ERR_TRANSLATION_UNAVAILABLE",
  TRANSLATION_FAILED: "ERR_TRANSLATION_FAILED",
  AWARD_LIMIT_EXCEEDED: "ERR_AWARD_LIMIT_EXCEEDED",
  AWARD_DAILY_LIMIT_EXCEEDED: "ERR_AWARD_DAILY_LIMIT_EXCEEDED",
  PUSH_TOKEN_CLAIMED: "ERR_PUSH_TOKEN_CLAIMED",
  COURSE_NODE_CERTIFIED: "ERR_COURSE_NODE_CERTIFIED",
  COURSE_NODE_NOT_COMPLETE: "ERR_COURSE_NODE_NOT_COMPLETE",
  COURSE_NODE_HAS_CERTIFICATIONS: "ERR_COURSE_NODE_HAS_CERTIFICATIONS",
  COURSE_NODE_NOT_FOUND: "ERR_COURSE_NODE_NOT_FOUND",
  COURSE_STUDENT_OUT_OF_SCOPE: "ERR_COURSE_STUDENT_OUT_OF_SCOPE",
  COURSE_NOT_PUBLISHABLE: "ERR_COURSE_NOT_PUBLISHABLE",
  LIBRARY_REQUEST_RATE_LIMITED: "ERR_LIBRARY_REQUEST_RATE_LIMITED",
  LIBRARY_REQUEST_PENDING_LIMIT: "ERR_LIBRARY_REQUEST_PENDING_LIMIT",
  LIBRARY_REQUEST_ACTION_FORBIDDEN: "ERR_LIBRARY_REQUEST_ACTION_FORBIDDEN",
  LIBRARY_PDF_TOO_LARGE: "ERR_LIBRARY_PDF_TOO_LARGE",
  CITY_SLUG_CONFLICT: "ERR_CITY_SLUG_CONFLICT",
  TEAM_PUBLISH_FORBIDDEN: "ERR_TEAM_PUBLISH_FORBIDDEN",
  TEAM_SCOPE_INVALID: "ERR_TEAM_SCOPE_INVALID",
  TEAM_DESIGNATION_REQUIRED: "ERR_TEAM_DESIGNATION_REQUIRED",
  TEAM_MEMBER_DUPLICATE: "ERR_TEAM_MEMBER_DUPLICATE",
} as const satisfies Record<string, ErrorCode>;

/** Server + client upload size cap (multer + pre-upload guard). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Library granth PDF cap — Section 17 v3 §17.11.2. Higher than MAX_UPLOAD_BYTES
 * because scanned granths run large; confirmable against the first real upload
 * batch (v3 Open Decision 3).
 */
export const MAX_LIBRARY_PDF_BYTES = 100 * 1024 * 1024;

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
  ERR_TRANSLATION_UNAVAILABLE: {
    en: "Hindi translation is not configured on this server — ask an admin to set TRANSLATION_PROVIDER, or type the Hindi yourself.",
    hi: "इस सर्वर पर हिंदी अनुवाद उपलब्ध नहीं है — एडमिन से TRANSLATION_PROVIDER सेट करवाएँ, या हिंदी स्वयं लिखें।",
  },
  ERR_TRANSLATION_FAILED: {
    en: "The translation could not be used — check the English text and try again, or type the Hindi yourself.",
    hi: "अनुवाद उपयोग नहीं हो सका — अंग्रेज़ी पाठ जाँचकर फिर कोशिश करें, या हिंदी स्वयं लिखें।",
  },
  ERR_LIBRARY_REQUEST_RATE_LIMITED: {
    en: "You have sent all the content requests allowed for today — try again tomorrow, or add detail to a request you already sent.",
    hi: "आज के लिए अनुमत सभी सामग्री अनुरोध भेजे जा चुके हैं — कल फिर भेजें, या पहले भेजे अनुरोध में विवरण जोड़ें।",
  },
  ERR_LIBRARY_REQUEST_PENDING_LIMIT: {
    en: "Your earlier requests are still waiting for review — wait for one to be answered before sending another.",
    hi: "आपके पिछले अनुरोध अभी समीक्षा की प्रतीक्षा में हैं — नया भेजने से पहले किसी एक का उत्तर आने दें।",
  },
  ERR_LIBRARY_REQUEST_ACTION_FORBIDDEN: {
    en: "Only a state or national admin can accept or reject content requests — you can read the queue and pass this one on.",
    hi: "सामग्री अनुरोध स्वीकार या अस्वीकार केवल राज्य या राष्ट्रीय एडमिन कर सकते हैं — आप सूची देख सकते हैं और यह अनुरोध आगे भेज सकते हैं।",
  },
  ERR_LIBRARY_PDF_TOO_LARGE: {
    en: "That PDF is too large (max 100 MB). Compress the scan or split it into volumes and upload again.",
    hi: "यह PDF बहुत बड़ा है (अधिकतम 100 MB)। स्कैन को कंप्रेस करें या खंडों में बाँटकर फिर अपलोड करें।",
  },
  ERR_CITY_SLUG_CONFLICT: {
    en: "That city slug is already taken — choose a different slug (for example append the state code).",
    hi: "यह शहर स्लग पहले से उपयोग में है — कोई अन्य स्लग चुनें (उदाहरण के लिए राज्य कोड जोड़ें)।",
  },
  ERR_TEAM_PUBLISH_FORBIDDEN: {
    en: "You cannot manage Team members outside your scope — ask a city or state admin.",
    hi: "आप अपनी सीमा के बाहर टीम सदस्यों का प्रबंधन नहीं कर सकते — सिटी या राज्य एडमिन से संपर्क करें।",
  },
  ERR_TEAM_SCOPE_INVALID: {
    en: "That Team scope does not match state/city/centre — fix the geography fields and try again.",
    hi: "यह टीम स्कोप राज्य/शहर/केंद्र से मेल नहीं खाता — भूगोल फ़ील्ड ठीक करके फिर कोशिश करें।",
  },
  ERR_TEAM_DESIGNATION_REQUIRED: {
    en: "This Team card has no designation — set designation_en (and designation_hi) before publishing.",
    hi: "इस टीम कार्ड पर पदनाम नहीं है — प्रकाशित करने से पहले designation_en (और designation_hi) सेट करें।",
  },
  ERR_TEAM_MEMBER_DUPLICATE: {
    en: "That user already has a Team card — edit the existing row instead of creating another.",
    hi: "उस उपयोगकर्ता का टीम कार्ड पहले से है — नया बनाने के बजाय मौजूदा पंक्ति संपादित करें।",
  },
} as const satisfies Partial<Record<ErrorCode, { en: string; hi: string }>>;
