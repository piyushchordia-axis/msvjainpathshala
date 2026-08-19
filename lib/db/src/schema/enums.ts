import { pgEnum } from "drizzle-orm/pg-core";

export const ROLES = [
  "super_admin",
  "state_admin",
  "city_admin",
  "sanchalak",
  "shikshak",
  "parent",
  "student",
  "guest",
] as const;

export const GENDERS = ["male", "female", "other"] as const;
export const LANGUAGES = ["en", "hi"] as const;
export const AGE_GROUPS = ["bal", "kishor", "tarun", "yuva"] as const;

/** Display metadata for age groups (year ranges). Change here to update all UIs. */
export const AGE_GROUP_META = {
  bal: { label_en: "Bal 5-8 years", label_hi: "बाल 5-8 वर्ष", min: 5, max: 8 },
  kishor: { label_en: "Kishor 9-12 years", label_hi: "किशोर 9-12 वर्ष", min: 9, max: 12 },
  tarun: { label_en: "Tarun 13-16 years", label_hi: "तरुण 13-16 वर्ष", min: 13, max: 16 },
  yuva: { label_en: "Yuva 17-21 years", label_hi: "युवा 17-21 वर्ष", min: 17, max: 21 },
} as const satisfies Record<
  (typeof AGE_GROUPS)[number],
  { label_en: string; label_hi: string; min: number; max: number }
>;

export type AgeGroup = (typeof AGE_GROUPS)[number];

/** Whole years completed as of `on` (default today, local calendar). */
export function ageYearsFromDob(dob: string | Date, on: Date = new Date()): number {
  const d = typeof dob === "string" ? new Date(`${dob.slice(0, 10)}T00:00:00`) : dob;
  if (Number.isNaN(d.getTime())) return NaN;
  let age = on.getFullYear() - d.getFullYear();
  const monthDelta = on.getMonth() - d.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && on.getDate() < d.getDate())) age -= 1;
  return age;
}

/** Map DOB → age group using AGE_GROUP_META ranges. Null if outside 5–21. */
export function ageGroupFromDob(dob: string | Date, on: Date = new Date()): AgeGroup | null {
  const age = ageYearsFromDob(dob, on);
  if (!Number.isFinite(age) || age < 0) return null;
  for (const g of AGE_GROUPS) {
    const meta = AGE_GROUP_META[g];
    if (age >= meta.min && age <= meta.max) return g;
  }
  return null;
}

export function formatAgeGroup(code: string, lang: "en" | "hi" = "en"): string {
  const meta = AGE_GROUP_META[code as AgeGroup];
  if (!meta) return code;
  return lang === "hi" ? meta.label_hi : meta.label_en;
}

/** Join labels; all four known groups → "All age groups" / "सभी आयु वर्ग". */
export function formatAgeGroups(codes: string[] | null | undefined, lang: "en" | "hi" = "en"): string {
  const list = (codes ?? []).filter(Boolean);
  if (list.length === 0) return lang === "hi" ? "—" : "—";
  const allKnown = AGE_GROUPS.every((g) => list.includes(g)) && list.length >= AGE_GROUPS.length;
  if (allKnown) return lang === "hi" ? "सभी आयु वर्ग" : "All age groups";
  return list.map((c) => formatAgeGroup(c, lang)).join(" · ");
}

/** AT1 — present | absent | late | excused */
export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"] as const;
export const SESSION_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
/** Offline sync_operations.status (CLAUDE.md Offline sync §4 + claim 'processing'). */
export const SYNC_OP_STATUSES = ["success", "duplicate", "conflict", "failed", "processing"] as const;
export const STUDENT_STATUSES = ["active", "inactive"] as const;
export const ENROLMENT_STATUSES = ["pending", "approved", "rejected", "waitlisted"] as const;
export const MSV_STATUSES = ["none", "applied", "waitlisted", "approved", "rejected", "revoked"] as const;
export const TIERS = ["jigyasu", "shravak", "sadhak", "shraman", "tirthankar"] as const;
export const NIYAM_TYPES = ["daily", "weekly", "monthly"] as const;
/** Streak milestone badge keys (frequency-aware ladder — see NIYAM_MODULE_FIX_PLAN D1). */
export const NIYAM_BADGE_KEYS = [
  "daily_7",
  "daily_14",
  "daily_30",
  "daily_60",
  "daily_100",
  "weekly_4",
  "monthly_3",
] as const;
/** Allowed media kinds. `either` = photo|video; `any` = photo|video|audio. */
export const PROOF_TYPES = ["photo", "video", "audio", "either", "any"] as const;
export const NIYAM_APPROVAL_MODES = ["auto", "review"] as const;
export const NIYAM_MEDIA_KINDS = ["photo", "video", "audio"] as const;
export const NIYAM_SUBMISSION_STATUSES = ["pending", "auto_approved", "approved", "rejected"] as const;
/** Geographic reach of a niyam definition. */
export const NIYAM_SCOPES = ["national", "state", "city"] as const;
/** Which students a niyam is offered to, relative to MSV membership. */
export const NIYAM_MSV_AUDIENCES = ["all", "msv", "non_msv"] as const;
export const ATTENDANCE_METHODS = ["manual", "gps"] as const;
export const EXAM_QUESTION_TYPES = ["single_choice", "multi_choice", "text"] as const;
export const NOTICE_AUDIENCES = ["batch", "centre", "city", "state", "national", "msv"] as const;
export const SHIVIR_ATTENDANCE_MODES = ["in_out", "present_only"] as const;
export const SHIVIR_SCAN_KINDS = ["check_in", "check_out", "present"] as const;
/**
 * Section.type drives client rendering — never key UI off section name_*.
 * `granth` renders the two-tab screen (Online Granth + physical library
 * directory) — Section 17 v3 §17.1.2.
 */
export const LIBRARY_SECTION_TYPES = ["item_list", "deeplink", "panchang", "granth"] as const;
/** Local-only DownloadedAudio / DownloadedPdf status (not a Postgres enum). */
export const LIBRARY_DOWNLOAD_STATUSES = ["queued", "downloading", "complete", "failed"] as const;
/**
 * Content-request lifecycle (v3 §17.10.4). `published` is system-set when the
 * linked item is published; `rejected` and `published` are terminal.
 */
export const LIBRARY_CONTENT_REQUEST_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "published",
] as const;
/**
 * Access-log events (v3 §17.9). `view` is the base item open; the other
 * four are the v3 additions. Distinct reach per (item, actor, event) —
 * re-opening a stotra thirty times is one reader, not thirty.
 */
export const LIBRARY_ACCESS_EVENTS = [
  "view",
  "pdf_view",
  "pdf_download",
  "granth_view",
  "external_link_open",
] as const;
// acknowledged = parent mark-done without upload (F1); returned = Guruji sent
// work back for rework (F9). Both added in migration 0023.
export const HOMEWORK_STATUSES = [
  "pending",
  "submitted",
  "approved",
  "starred",
  "late",
  "acknowledged",
  "returned",
] as const;
export const SERVICE_REQUEST_STATUSES = ["submitted", "in_review", "resolved"] as const;
export const CURRICULUM_LEVELS = ["not_started", "in_progress", "completed", "mastered"] as const;
/** CU4 — course lifecycle. Default draft; publish is an audited transition. */
export const COURSE_STATUSES = ["draft", "active", "archived"] as const;
export const QUIZ_SCOPES = ["national", "state", "city", "centre", "batch"] as const;
export const COMPETITION_STATUSES = ["draft", "open", "closed", "results_published"] as const;
/** Attempt lifecycle — abandoned frees a max_attempts slot. */
export const EXAM_ATTEMPT_STATUSES = [
  "in_progress",
  "submitted",
  "graded",
  "abandoned",
] as const;
export const NOTIFICATION_KINDS = [
  "general",
  "birthday",
  "homework",
  "quiz",
  "competition",
  "service_request",
  "exam",
  "shivir",
  "niyam_rejected",
  /**
   * A review-mode submission approved by a Guruji. Only rejection and badges
   * were ever notified, so a child whose niyam was approved heard nothing —
   * the one outcome worth telling them about.
   */
  "niyam_approved",
  "niyam_badge",
  "attendance",
  "attendance_streak",
  "donation",
  "gallery",
  "join",
  /** Library content request published (Section 17 v3 §17.10.7). */
  "library",
] as const;
export const DONATION_PAYMENT_STATUSES = ["created", "pending", "captured", "failed", "refunded"] as const;

/** Team module — public directory scope (national → centre). */
export const TEAM_SCOPE_LEVELS = ["national", "state", "city", "centre"] as const;
/** Team category layout. `featured` is reserved; renderers fall back to grid. */
export const TEAM_DISPLAY_STYLES = ["featured", "grid", "list"] as const;
/** Optional grouping within a team category (e.g. Gurujis by centre). */
export const TEAM_GROUP_BYS = ["none", "centre"] as const;

export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "approve",
  "reject",
  "assign",
  "resolve",
  "grade",
  "award",
  "config_change",
  "login",
  "logout",
] as const;

export const TIER_THRESHOLDS: Record<(typeof TIERS)[number], number> = {
  jigyasu: 0,
  shravak: 101,
  sadhak: 501,
  shraman: 1501,
  tirthankar: 5001,
};

export function tierForPoints(totalPoints: number): (typeof TIERS)[number] {
  let current: (typeof TIERS)[number] = "jigyasu";
  for (const t of TIERS) {
    if (totalPoints >= TIER_THRESHOLDS[t]) current = t;
  }
  return current;
}

export const roleEnum = pgEnum("role_enum", ROLES);
export const genderEnum = pgEnum("gender_enum", GENDERS);
export const languageEnum = pgEnum("language_enum", LANGUAGES);
export const ageGroupEnum = pgEnum("age_group_enum", AGE_GROUPS);
export const attendanceStatusEnum = pgEnum("attendance_status_enum", ATTENDANCE_STATUSES);
export const sessionStatusEnum = pgEnum("session_status_enum", SESSION_STATUSES);
export const syncOpStatusEnum = pgEnum("sync_op_status_enum", SYNC_OP_STATUSES);
export const studentStatusEnum = pgEnum("student_status_enum", STUDENT_STATUSES);
export const enrolmentStatusEnum = pgEnum("enrolment_status_enum", ENROLMENT_STATUSES);
export const msvStatusEnum = pgEnum("msv_status_enum", MSV_STATUSES);
export const tierEnum = pgEnum("tier_enum", TIERS);
export const niyamTypeEnum = pgEnum("niyam_type_enum", NIYAM_TYPES);
export const niyamBadgeKeyEnum = pgEnum("niyam_badge_key_enum", NIYAM_BADGE_KEYS);
export const proofTypeEnum = pgEnum("proof_type_enum", PROOF_TYPES);
export const niyamApprovalModeEnum = pgEnum("niyam_approval_mode_enum", NIYAM_APPROVAL_MODES);
export const niyamMediaKindEnum = pgEnum("niyam_media_kind_enum", NIYAM_MEDIA_KINDS);
export const niyamSubmissionStatusEnum = pgEnum("niyam_submission_status_enum", NIYAM_SUBMISSION_STATUSES);
export const niyamScopeEnum = pgEnum("niyam_scope_enum", NIYAM_SCOPES);
export const niyamMsvAudienceEnum = pgEnum("niyam_msv_audience_enum", NIYAM_MSV_AUDIENCES);
export const attendanceMethodEnum = pgEnum("attendance_method_enum", ATTENDANCE_METHODS);
export const examQuestionTypeEnum = pgEnum("exam_question_type_enum", EXAM_QUESTION_TYPES);
export const examAttemptStatusEnum = pgEnum("exam_attempt_status_enum", EXAM_ATTEMPT_STATUSES);
export const noticeAudienceEnum = pgEnum("notice_audience_enum", NOTICE_AUDIENCES);
export const shivirAttendanceModeEnum = pgEnum("shivir_attendance_mode_enum", SHIVIR_ATTENDANCE_MODES);
export const shivirScanKindEnum = pgEnum("shivir_scan_kind_enum", SHIVIR_SCAN_KINDS);
export const librarySectionTypeEnum = pgEnum("library_section_type_enum", LIBRARY_SECTION_TYPES);
export const libraryContentRequestStatusEnum = pgEnum(
  "library_content_request_status_enum",
  LIBRARY_CONTENT_REQUEST_STATUSES,
);
export const libraryAccessEventEnum = pgEnum(
  "library_access_event_enum",
  LIBRARY_ACCESS_EVENTS,
);
export const homeworkStatusEnum = pgEnum("homework_status_enum", HOMEWORK_STATUSES);
export const serviceRequestStatusEnum = pgEnum("service_request_status_enum", SERVICE_REQUEST_STATUSES);
export const curriculumLevelEnum = pgEnum("curriculum_level_enum", CURRICULUM_LEVELS);
export const courseStatusEnum = pgEnum("course_status_enum", COURSE_STATUSES);
export const auditActionEnum = pgEnum("audit_action_enum", AUDIT_ACTIONS);
export const quizScopeEnum = pgEnum("quiz_scope_enum", QUIZ_SCOPES);
export const competitionStatusEnum = pgEnum("competition_status_enum", COMPETITION_STATUSES);
export const notificationKindEnum = pgEnum("notification_kind_enum", NOTIFICATION_KINDS);
export const donationPaymentStatusEnum = pgEnum("donation_payment_status_enum", DONATION_PAYMENT_STATUSES);
export const teamScopeLevelEnum = pgEnum("team_scope_level", TEAM_SCOPE_LEVELS);
export const teamDisplayStyleEnum = pgEnum("team_display_style", TEAM_DISPLAY_STYLES);
export const teamGroupByEnum = pgEnum("team_group_by", TEAM_GROUP_BYS);
