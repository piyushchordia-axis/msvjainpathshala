/**
 * BullMQ queue registry — the 30 worker-side queues this API process knows
 * how to enqueue to and (in `apps/api/src/queues/processors/*`) drain.
 *
 * Names come from the CLAUDE.md "All 30 BullMQ queues" list which Step 7's
 * prompt nominates as authoritative for the actually-active queue set. This
 * differs from SPEC §9.1's draft in a handful of names (see comment block at
 * the bottom of this file) — overlap with @jp/shared/constants/queues.ts is
 * intentional and the shared/jp constant stays as-is for cross-package use.
 *
 * Adding a queue:
 *   1. Add it to QUEUES below (the QUEUE_COUNT assertion blocks misedits).
 *   2. Add a default-job-options entry in QUEUE_DEFAULT_JOB_OPTIONS if it
 *      needs anything beyond the global defaults in queues.module.ts.
 *   3. Add a processor under apps/api/src/queues/processors/ AND register it
 *      in QueuesModule.processors (worker-side only).
 *
 * DO NOT hardcode queue name strings anywhere else — always import via
 * `QUEUES.XXX` or `QUEUE_NAMES`.
 */

export const QUEUES = {
  AUTH_SMS_OTP: 'auth.sms.otp',
  NOTIFICATIONS_FANOUT: 'notifications.fanout',
  NOTIFICATIONS_PUSH: 'notifications.push',
  NOTIFICATIONS_SMS: 'notifications.sms',
  NOTIFICATIONS_EMAIL: 'notifications.email',
  ATTENDANCE_POST_PROCESS: 'attendance.post_process',
  ATTENDANCE_CONSECUTIVE_CHECK: 'attendance.consecutive_check',
  PUNYA_AWARD: 'punya.award',
  PUNYA_LEADERBOARD_REFRESH: 'punya.leaderboard.refresh',
  PUNYA_RECONCILE: 'punya.reconcile',
  NIYAM_STREAK_RECOMPUTE: 'niyam.streak.recompute',
  MEDIA_PROCESSING: 'media.processing',
  ID_CARD_GENERATION: 'idcard.generation',
  REPORT_GENERATION: 'report.generation',
  REPORT_SHIVIR_EXPORT: 'report.shivir.export',
  EXPORT_STUDENT_PDF: 'export.student.pdf',
  EXPORT_BULK_ZIP: 'export.bulk.zip',
  DONATION_EIGHTYG_CERT: 'donation.eightyg.cert',
  DONATION_RECEIPT_GENERATE: 'donation.receipt.generate',
  AUDIT_WRITE: 'audit.write',
  AI_QUIZ_GENERATE: 'ai.quiz.generate',
  AI_MODERATION_IMAGE: 'ai.moderation.image',
  SHIVIR_LIVE_BROADCAST: 'shivir.live.broadcast',
  ANALYTICS_REFRESH_VIEWS: 'analytics.refresh_views',
  DIGEST_WEEKLY_EMAIL: 'digest.weekly.email',
  DB_BACKFILL_GENERIC: 'db.backfill.generic',
  AUTH_SESSION_CLEANUP: 'auth.session.cleanup',
  NOTIFICATIONS_BIRTHDAY: 'notifications.birthday',
  NOTIFICATIONS_MONTHLY_REPORTS: 'notifications.monthly_reports',
  DEBUG_ECHO: 'debug.echo',
} as const;

export type QueueKey = keyof typeof QUEUES;
export type QueueName = (typeof QUEUES)[QueueKey];

export const QUEUE_NAMES: readonly QueueName[] = Object.freeze(Object.values(QUEUES));

export const QUEUE_COUNT = 30;
if (QUEUE_NAMES.length !== QUEUE_COUNT) {
  throw new Error(
    `[queues] expected exactly ${QUEUE_COUNT} queues per CLAUDE.md / Step 7, got ${QUEUE_NAMES.length}.`,
  );
}
const _uniqueQueueNames = new Set(QUEUE_NAMES);
if (_uniqueQueueNames.size !== QUEUE_NAMES.length) {
  throw new Error('[queues] duplicate queue name detected — every queue must be unique.');
}

/**
 * DLQ suffix — every queue X has a paired X.dlq into which BaseProcessor moves
 * jobs that exhaust their retry budget.
 */
export const DLQ_SUFFIX = '.dlq' as const;

export function dlqName(queue: QueueName): string {
  return `${queue}${DLQ_SUFFIX}`;
}

export function isDlqName(name: string): boolean {
  return name.endsWith(DLQ_SUFFIX);
}

/**
 * Compare-and-match helper for admin routes. Throws if the path parameter is
 * not one of the known queue names (or its DLQ).
 */
export function assertKnownQueueName(name: string): QueueName {
  const stripped = name.endsWith(DLQ_SUFFIX) ? name.slice(0, -DLQ_SUFFIX.length) : name;
  if (!_uniqueQueueNames.has(stripped as QueueName)) {
    throw new Error(`unknown queue: ${name}`);
  }
  return stripped as QueueName;
}

/**
 * --- Divergence from SPEC §9.1 ------------------------------------------
 * SPEC §9.1 has 30 queues but they don't match this set exactly:
 *   - SPEC only:    punya.tier.recompute, gallery.visibility.update,
 *                   media.virus_scan, media.thumbnail, media.exif_strip,
 *                   donation.receipt.pdf, ai.moderation, ai.translate,
 *                   ai.report.summarise, analytics.aggregation,
 *                   webhook.razorpay, sync.dead_letter
 *   - CLAUDE.md+:   attendance.consecutive_check, punya.award,
 *                   report.shivir.export, donation.receipt.generate,
 *                   ai.moderation.image, digest.weekly.email,
 *                   db.backfill.generic, auth.session.cleanup,
 *                   notifications.birthday, notifications.monthly_reports,
 *                   debug.echo
 * Step 7's prompt is explicit: use the CLAUDE.md list. @jp/shared QUEUES
 * keeps the SPEC §9.1 list for cross-package type contracts and is wired
 * into Step 5 (audit.write) and Step 6 (notifications.fanout) — both names
 * appear in BOTH lists, so the existing producers still work.
 */
