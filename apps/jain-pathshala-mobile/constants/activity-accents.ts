import colors from "@/constants/colors";

type ActivityTokenName = Extract<keyof typeof colors.light, `activity${string}`>;

/**
 * Activity grid feature accents. Same-domain tiles share a key
 * (e.g. parent / Guruji / admin homework all use `homework`).
 */
export const ACTIVITY_ACCENT_KEYS = [
  "notifications",
  "attendance",
  "niyam",
  "courses",
  "certificates",
  "homework",
  "quizzes",
  "exams",
  "competitions",
  "students",
  "batches",
  "punya",
  "join",
  "profile",
  "centres",
  "shikshaks",
  "holidays",
  "notices",
  "serviceRequests",
  "gallery",
  "reports",
  "enrolments",
  "library",
  "shivirs",
] as const;

export type ActivityAccentKey = (typeof ACTIVITY_ACCENT_KEYS)[number];

/** Palette token on `colors.light` for each activity accent. */
export const ACTIVITY_ACCENT_TOKEN = {
  notifications: "activityNotifications",
  attendance: "activityAttendance",
  niyam: "activityNiyam",
  courses: "activityCourses",
  certificates: "activityCertificates",
  homework: "activityHomework",
  quizzes: "activityQuizzes",
  exams: "activityExams",
  competitions: "activityCompetitions",
  students: "activityStudents",
  batches: "activityBatches",
  punya: "activityPunya",
  join: "activityJoin",
  profile: "activityProfile",
  centres: "activityCentres",
  shikshaks: "activityShikshaks",
  holidays: "activityHolidays",
  notices: "activityNotices",
  serviceRequests: "activityServiceRequests",
  gallery: "activityGallery",
  reports: "activityReports",
  enrolments: "activityEnrolments",
  library: "activityLibrary",
  shivirs: "activityShivirs",
} as const satisfies Record<ActivityAccentKey, ActivityTokenName>;
