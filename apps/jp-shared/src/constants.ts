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
  NOTIFICATIONS_MONTHLY_REPORTS: "notifications.monthly_reports",
  PUNYA_LEADERBOARD_REFRESH: "punya.leaderboard.refresh",
  PUNYA_RECONCILE: "punya.reconcile",
  ANALYTICS_REFRESH_VIEWS: "analytics.refresh_views",
  DIGEST_WEEKLY_EMAIL: "digest.weekly.email",
  AUTH_SESSION_CLEANUP: "auth.session.cleanup",
  MEDIA_CLEANUP_UNFINALIZED: "media.cleanup_unfinalized",
  DONATION_EIGHTYG_YEAR_END: "donation.eightyg.year_end_summary",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Cron expressions (Asia/Kolkata) — frozen CLAUDE.md table. */
export const CRON_EXPRESSIONS = {
  SESSION_MATERIALISE: "0 1 * * *", // nightly 01:00 IST
  ATTENDANCE_NO_SHOW_CHECK: "*/15 * * * *",
  ATTENDANCE_AUTO_CHECKOUT: "*/30 * * * *",
  ATTENDANCE_CONSECUTIVE_CHECK: "0 2 * * *", // AT27 — 02:00 IST following day
  NOTIFICATIONS_BIRTHDAY: "0 6 * * *",
  NOTIFICATIONS_MONTHLY_REPORTS: "0 2 1 * *", // 1st of month 02:00 IST
  PUNYA_LEADERBOARD_REFRESH: "*/5 * * * *",
  PUNYA_RECONCILE: "0 3 * * *",
  ANALYTICS_REFRESH_VIEWS: "0 4 * * *",
  DIGEST_WEEKLY_EMAIL: "0 7 * * 1", // Monday 07:00 IST
  AUTH_SESSION_CLEANUP: "30 2 * * *",
  MEDIA_CLEANUP_UNFINALIZED: "30 3 * * *",
  DONATION_EIGHTYG_YEAR_END: "30 0 1 4 *", // 1 April 00:30 IST
} as const;
