/**
 * Single source of truth for BullMQ queue names.
 * Import from `@jp/shared/constants` — never inline these strings.
 *
 * Schedule-kind jobs from the frozen cron table that are NOT queues still use
 * CRON_EXPRESSIONS for registration via node-cron.
 */
export const QUEUE_NAMES = {
  SESSION_MATERIALISE: "session.materialise",
  ATTENDANCE_AUTO_CHECKOUT: "attendance.auto_checkout",
  ATTENDANCE_NO_SHOW_CHECK: "attendance.no_show_check",
  ATTENDANCE_POST_PROCESS: "attendance.post_process",
  ATTENDANCE_CONSECUTIVE_CHECK: "attendance.consecutive_check",
  PARENT_NOTIFY: "notifications.parent",
  NOTIFICATIONS_BIRTHDAY: "notifications.birthday",
  /** Sweep Expo push receipts and deactivate DeviceNotRegistered tokens. */
  NOTIFICATIONS_PUSH_RECEIPTS: "notifications.push_receipts",
  /** Daily streak-lapse job (ReplitAgent §9.5) — not a BullMQ queue. */
  NIYAM_STREAK_LAPSE: "niyam-streak-lapse",
  NOTIFICATIONS_MONTHLY_REPORTS: "notifications.monthly_reports",
  PUNYA_LEADERBOARD_REFRESH: "punya.leaderboard.refresh",
  PUNYA_RECONCILE: "punya.reconcile",
  ANALYTICS_REFRESH_VIEWS: "analytics.refresh_views",
  DIGEST_WEEKLY_EMAIL: "digest.weekly.email",
  AUTH_SESSION_CLEANUP: "auth.session.cleanup",
  MEDIA_CLEANUP_UNFINALIZED: "media.cleanup_unfinalized",
  DONATION_EIGHTYG_YEAR_END: "donation.eightyg.year_end_summary",
  /** Mark stale in_progress exam attempts abandoned (window_end + 2h). */
  EXAM_ATTEMPT_ABANDON: "exam.attempt_abandon",
  /** Award exam top-score Punya after results_released. */
  EXAM_TOP_SCORE: "exam.top_score",
  /** Chunked digital ID-card PNG generation (PERF #12). */
  IDCARD_GENERATION: "idcard.generation",
  /** Centre monthly aggregate PDF (Sanchalak / admin). */
  REPORT_GENERATION: "report.generation",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Cron expressions (Asia/Kolkata) — frozen CLAUDE.md table. */
export const CRON_EXPRESSIONS = {
  SESSION_MATERIALISE: "0 1 * * *", // nightly 01:00 IST
  ATTENDANCE_NO_SHOW_CHECK: "*/15 * * * *",
  ATTENDANCE_AUTO_CHECKOUT: "*/30 * * * *",
  ATTENDANCE_CONSECUTIVE_CHECK: "0 2 * * *", // AT27 — 02:00 IST following day
  NOTIFICATIONS_BIRTHDAY: "0 6 * * *",
  /** Expo receipt sweep — every 30 minutes. */
  NOTIFICATIONS_PUSH_RECEIPTS: "*/30 * * * *",
  NIYAM_STREAK_LAPSE: "0 5 * * *", // ReplitAgent §9.5 — zero lapsed current_streak
  NOTIFICATIONS_MONTHLY_REPORTS: "0 2 1 * *", // 1st of month 02:00 IST
  PUNYA_LEADERBOARD_REFRESH: "*/5 * * * *",
  PUNYA_RECONCILE: "0 3 * * *",
  ANALYTICS_REFRESH_VIEWS: "0 4 * * *",
  DIGEST_WEEKLY_EMAIL: "0 7 * * 1", // Monday 07:00 IST
  AUTH_SESSION_CLEANUP: "30 2 * * *",
  MEDIA_CLEANUP_UNFINALIZED: "30 3 * * *",
  DONATION_EIGHTYG_YEAR_END: "30 0 1 4 *", // 1 April 00:30 IST
  /** Exam abandon sweep — same cadence as AT12 auto-checkout. */
  EXAM_ATTEMPT_ABANDON: "*/30 * * * *",
  /** Top-score catch-up for released exams (primary path is enqueue on release). */
  EXAM_TOP_SCORE: "15 3 * * *",
} as const;
