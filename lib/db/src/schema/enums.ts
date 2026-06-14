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
export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"] as const;
export const SESSION_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
export const STUDENT_STATUSES = ["active", "inactive"] as const;
export const ENROLMENT_STATUSES = ["pending", "approved", "rejected", "waitlisted"] as const;
export const MSV_STATUSES = ["none", "applied", "waitlisted", "approved", "rejected", "revoked"] as const;
export const TIERS = ["jigyasu", "shravak", "sadhak", "shraman", "tirthankar"] as const;
export const NIYAM_TYPES = ["daily", "weekly", "monthly"] as const;
export const PROOF_TYPES = ["photo", "video", "either"] as const;
export const NIYAM_SUBMISSION_STATUSES = ["pending", "auto_approved", "approved", "rejected"] as const;
export const ATTENDANCE_METHODS = ["manual", "gps"] as const;
export const EXAM_QUESTION_TYPES = ["single_choice", "multi_choice", "text"] as const;
export const NOTICE_AUDIENCES = ["batch", "centre", "city", "state", "national", "msv"] as const;
export const SHIVIR_ATTENDANCE_MODES = ["in_out", "present_only"] as const;
export const SHIVIR_SCAN_KINDS = ["check_in", "check_out", "present"] as const;
export const LIBRARY_CONTENT_TYPES = ["pdf", "video", "audio", "image"] as const;
export const LIBRARY_ACCESS_TIERS = ["public", "student", "msv", "shikshak"] as const;

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
export const studentStatusEnum = pgEnum("student_status_enum", STUDENT_STATUSES);
export const enrolmentStatusEnum = pgEnum("enrolment_status_enum", ENROLMENT_STATUSES);
export const msvStatusEnum = pgEnum("msv_status_enum", MSV_STATUSES);
export const tierEnum = pgEnum("tier_enum", TIERS);
export const niyamTypeEnum = pgEnum("niyam_type_enum", NIYAM_TYPES);
export const proofTypeEnum = pgEnum("proof_type_enum", PROOF_TYPES);
export const niyamSubmissionStatusEnum = pgEnum("niyam_submission_status_enum", NIYAM_SUBMISSION_STATUSES);
export const attendanceMethodEnum = pgEnum("attendance_method_enum", ATTENDANCE_METHODS);
export const examQuestionTypeEnum = pgEnum("exam_question_type_enum", EXAM_QUESTION_TYPES);
export const noticeAudienceEnum = pgEnum("notice_audience_enum", NOTICE_AUDIENCES);
export const shivirAttendanceModeEnum = pgEnum("shivir_attendance_mode_enum", SHIVIR_ATTENDANCE_MODES);
export const shivirScanKindEnum = pgEnum("shivir_scan_kind_enum", SHIVIR_SCAN_KINDS);
export const libraryContentTypeEnum = pgEnum("library_content_type_enum", LIBRARY_CONTENT_TYPES);
export const libraryAccessTierEnum = pgEnum("library_access_tier_enum", LIBRARY_ACCESS_TIERS);
