/**
 * All BullMQ queue names — single source of truth (SPEC §9.1).
 *
 * `infra/queue/queue-names.ts` in the API re-exports this constant; never
 * hardcode a queue name as a string elsewhere in the codebase (CLAUDE.md
 * "Common pitfalls").
 *
 * Note on CLAUDE.md vs SPEC: CLAUDE.md "All 30 BullMQ queues" lists an
 * earlier draft naming (e.g. `donation.receipt.generate` vs the spec's
 * `donation.receipt.pdf`, and includes ops queues `auth.session.cleanup`,
 * `digest.weekly.email`, `notifications.birthday`, `notifications.monthly_reports`,
 * `db.backfill.generic`, `debug.echo` that don't appear in SPEC §9.1). The
 * SPEC version below wins for application code; the CLAUDE.md ops queues
 * can be added later via repeatable BullMQ jobs if Step 7 decides they are
 * needed as named queues.
 */

export const QUEUES = {
  AUTH_SMS_OTP: 'auth.sms.otp',
  NOTIFICATIONS_PUSH: 'notifications.push',
  NOTIFICATIONS_SMS: 'notifications.sms',
  NOTIFICATIONS_EMAIL: 'notifications.email',
  NOTIFICATIONS_FANOUT: 'notifications.fanout',
  ATTENDANCE_POST_PROCESS: 'attendance.post_process',
  PUNYA_LEADERBOARD_REFRESH: 'punya.leaderboard.refresh',
  PUNYA_TIER_RECOMPUTE: 'punya.tier.recompute',
  PUNYA_RECONCILE: 'punya.reconcile',
  NIYAM_STREAK_RECOMPUTE: 'niyam.streak.recompute',
  GALLERY_VISIBILITY_UPDATE: 'gallery.visibility.update',
  MEDIA_PROCESSING: 'media.processing',
  MEDIA_VIRUS_SCAN: 'media.virus_scan',
  MEDIA_THUMBNAIL: 'media.thumbnail',
  MEDIA_EXIF_STRIP: 'media.exif_strip',
  ID_CARD_GENERATION: 'idcard.generation',
  REPORT_GENERATION: 'report.generation',
  EXPORT_STUDENT_PDF: 'export.student.pdf',
  EXPORT_BULK_ZIP: 'export.bulk.zip',
  DONATION_RECEIPT_PDF: 'donation.receipt.pdf',
  DONATION_80G_CERT: 'donation.eightyg.cert',
  AUDIT_WRITE: 'audit.write',
  AI_QUIZ_GENERATE: 'ai.quiz.generate',
  AI_MODERATION: 'ai.moderation',
  AI_TRANSLATE: 'ai.translate',
  AI_REPORT_SUMMARISE: 'ai.report.summarise',
  ANALYTICS_AGGREGATION: 'analytics.aggregation',
  SHIVIR_LIVE_BROADCAST: 'shivir.live.broadcast',
  WEBHOOK_RAZORPAY: 'webhook.razorpay',
  SYNC_DEAD_LETTER: 'sync.dead_letter',
} as const;

export type QueueKey = keyof typeof QUEUES;
export type QueueName = (typeof QUEUES)[QueueKey];

/** All queue names as an array — useful for worker bootstrap / health checks. */
export const QUEUE_NAMES: readonly QueueName[] = Object.values(QUEUES);

/** Compile-time assertion that we cover exactly the 30 queues SPEC §9.1 mandates. */
type _AssertThirtyQueues = QueueKey extends infer K ? ([K] extends [string] ? K : never) : never;
const _expectedCount = 30;
// Runtime check kept here (not just a type) so a misedit fails fast on import.
if (QUEUE_NAMES.length !== _expectedCount) {
  // istanbul ignore next — guard rail
  throw new Error(
    `[@jp/shared] expected ${_expectedCount} queues per SPEC §9.1, got ${QUEUE_NAMES.length}.`,
  );
}
// Re-export to keep the type referenced (otherwise tsc strips it).
export type _QueueKeyAssertion = _AssertThirtyQueues;
