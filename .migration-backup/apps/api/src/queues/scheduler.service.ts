/**
 * SchedulerService — installs BullMQ repeatable jobs (Section 9 cron table).
 *
 * Source of truth: CLAUDE.md "10 scheduled cron jobs (all IST — Asia/Kolkata)".
 * Each entry maps to a queue from `QUEUES`; the SchedulerService calls
 * `Queue.upsertJobScheduler` on application bootstrap so the same job key is
 * idempotent across deploys (no duplicate schedulers when the worker restarts).
 *
 * Timezone handling: BullMQ's RepeatOptions accepts `tz` (cron-parser passes
 * it through to the cron expression evaluator). Patterns are written in IST
 * wall-clock time and `tz: 'Asia/Kolkata'` ensures DST-correctness (India
 * doesn't observe DST today, but the explicit zone is forward-compatible).
 *
 * We expose `getSchedulers()` so the admin /stats endpoint and the verifier
 * script can read the live list back out — exit criterion for Step 7 is to
 * print all 10 schedulers via `Queue.getJobSchedulers`.
 */

import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { formatInTimeZone } from 'date-fns-tz';

import { QUEUES, type QueueName } from './queues.constants';

import type { Queue } from 'bullmq';

export const IST_TZ = 'Asia/Kolkata';

export interface CronJobDefinition {
  /** Stable id used as the scheduler key (idempotent upsert). */
  id: string;
  queue: QueueName;
  /** Cron pattern in IST wall-clock time. */
  pattern: string;
  /** What this job does — printed on bootstrap for operator visibility. */
  description: string;
  /** Payload included with every scheduled fire. */
  data?: Record<string, unknown>;
}

/**
 * 10 scheduled cron jobs from CLAUDE.md (all IST). Times are in IST wall-clock.
 *
 * | Job                                  | Schedule         |
 * |--------------------------------------|------------------|
 * | notifications.birthday               | Daily 06:00      |
 * | notifications.monthly_reports        | 1st of month 02:00 |
 * | punya.leaderboard.refresh            | Every 5 min      |
 * | punya.reconcile                      | Daily 03:00      |
 * | analytics.refresh_views              | Daily 04:00      |
 * | digest.weekly.email                  | Monday 07:00     |
 * | auth.session.cleanup                 | Daily 02:30      |
 * | attendance.consecutive_check         | Daily 22:00      |
 * | media.cleanup_unfinalized            | Daily 03:30      |
 * | donation.eightyg.year_end_summary    | 1 April 00:30    |
 *
 * Two jobs (media.cleanup_unfinalized, donation.eightyg.year_end_summary)
 * don't have dedicated queues in the 30-queue list. We schedule them onto
 * the closest semantic queue (media.processing and donation.eightyg.cert
 * respectively) with a `job_kind` discriminator so the processor can branch.
 * Adjust as those queues evolve in later steps.
 */
export const CRON_JOBS: readonly CronJobDefinition[] = [
  {
    id: 'notifications.birthday.daily',
    queue: QUEUES.NOTIFICATIONS_BIRTHDAY,
    pattern: '0 6 * * *',
    description: 'Birthday wishes — daily 06:00 IST',
  },
  {
    id: 'notifications.monthly_reports.first-of-month',
    queue: QUEUES.NOTIFICATIONS_MONTHLY_REPORTS,
    pattern: '0 2 1 * *',
    description: 'Monthly progress reports — 1st of month 02:00 IST',
  },
  {
    id: 'punya.leaderboard.refresh.5min',
    queue: QUEUES.PUNYA_LEADERBOARD_REFRESH,
    pattern: '*/5 * * * *',
    description: 'Leaderboard ZSET refresh — every 5 minutes',
  },
  {
    id: 'punya.leaderboard.monthly_reset',
    queue: QUEUES.PUNYA_LEADERBOARD_REFRESH,
    // 5 minutes past midnight on the 1st of each month — gives the prior
    // month's last awards 5 minutes of grace to land in the ledger before
    // we snapshot.
    pattern: '5 0 1 * *',
    description: 'Snapshot previous-month leaderboard ZSETs into leaderboard_snapshots',
    data: { job_kind: 'monthly_reset' },
  },
  {
    id: 'punya.reconcile.daily',
    queue: QUEUES.PUNYA_RECONCILE,
    pattern: '0 3 * * *',
    description: 'Punya ledger reconciliation — daily 03:00 IST',
  },
  {
    id: 'analytics.refresh_views.daily',
    queue: QUEUES.ANALYTICS_REFRESH_VIEWS,
    pattern: '0 4 * * *',
    description: 'Refresh materialised analytics views — daily 04:00 IST',
  },
  {
    id: 'digest.weekly.email.monday',
    queue: QUEUES.DIGEST_WEEKLY_EMAIL,
    pattern: '0 7 * * 1',
    description: 'Weekly digest email — Monday 07:00 IST',
  },
  {
    id: 'auth.session.cleanup.daily',
    queue: QUEUES.AUTH_SESSION_CLEANUP,
    pattern: '30 2 * * *',
    description: 'Expired-session pruner — daily 02:30 IST',
  },
  {
    id: 'attendance.consecutive_check.daily',
    queue: QUEUES.ATTENDANCE_CONSECUTIVE_CHECK,
    pattern: '0 22 * * *',
    description: 'Consecutive-absence flagger — daily 22:00 IST',
  },
  {
    id: 'media.cleanup_unfinalized.daily',
    queue: QUEUES.MEDIA_PROCESSING,
    pattern: '30 3 * * *',
    description: 'Unfinalised media GC — daily 03:30 IST',
    data: { job_kind: 'cleanup_unfinalized' },
  },
  {
    id: 'donation.eightyg.year_end_summary.april-1',
    queue: QUEUES.DONATION_EIGHTYG_CERT,
    pattern: '30 0 1 4 *',
    description: '80G year-end summary — 1 April 00:30 IST',
    data: { job_kind: 'year_end_summary' },
  },
];

@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SchedulerService.name);
  /** Map of unique queue names → their injected Queue. Built in the constructor. */
  private readonly queues = new Map<QueueName, Queue>();

  constructor(
    @InjectQueue(QUEUES.NOTIFICATIONS_BIRTHDAY) q1: Queue,
    @InjectQueue(QUEUES.NOTIFICATIONS_MONTHLY_REPORTS) q2: Queue,
    @InjectQueue(QUEUES.PUNYA_LEADERBOARD_REFRESH) q3: Queue,
    @InjectQueue(QUEUES.PUNYA_RECONCILE) q4: Queue,
    @InjectQueue(QUEUES.ANALYTICS_REFRESH_VIEWS) q5: Queue,
    @InjectQueue(QUEUES.DIGEST_WEEKLY_EMAIL) q6: Queue,
    @InjectQueue(QUEUES.AUTH_SESSION_CLEANUP) q7: Queue,
    @InjectQueue(QUEUES.ATTENDANCE_CONSECUTIVE_CHECK) q8: Queue,
    @InjectQueue(QUEUES.MEDIA_PROCESSING) q9: Queue,
    @InjectQueue(QUEUES.DONATION_EIGHTYG_CERT) q10: Queue,
  ) {
    this.queues.set(QUEUES.NOTIFICATIONS_BIRTHDAY, q1);
    this.queues.set(QUEUES.NOTIFICATIONS_MONTHLY_REPORTS, q2);
    this.queues.set(QUEUES.PUNYA_LEADERBOARD_REFRESH, q3);
    this.queues.set(QUEUES.PUNYA_RECONCILE, q4);
    this.queues.set(QUEUES.ANALYTICS_REFRESH_VIEWS, q5);
    this.queues.set(QUEUES.DIGEST_WEEKLY_EMAIL, q6);
    this.queues.set(QUEUES.AUTH_SESSION_CLEANUP, q7);
    this.queues.set(QUEUES.ATTENDANCE_CONSECUTIVE_CHECK, q8);
    this.queues.set(QUEUES.MEDIA_PROCESSING, q9);
    this.queues.set(QUEUES.DONATION_EIGHTYG_CERT, q10);
  }

  async onApplicationBootstrap(): Promise<void> {
    const now = new Date();
    const nowIst = formatInTimeZone(now, IST_TZ, 'yyyy-MM-dd HH:mm:ss zzz');
    this.logger.log(`Installing ${CRON_JOBS.length} repeatable schedulers (now=${nowIst})`);

    for (const job of CRON_JOBS) {
      const queue = this.queues.get(job.queue);
      if (!queue) {
        this.logger.warn(`scheduler ${job.id}: no injected Queue for ${job.queue} — skipping`);
        continue;
      }
      await queue.upsertJobScheduler(
        job.id,
        { pattern: job.pattern, tz: IST_TZ },
        {
          name: job.id,
          data: job.data ?? {},
          opts: {
            removeOnComplete: { age: 86_400, count: 200 },
            removeOnFail: { age: 604_800 },
          },
        },
      );
      this.logger.log(`  ✓ ${job.id}  pattern="${job.pattern}" tz=${IST_TZ}  — ${job.description}`);
    }
  }

  /**
   * Returns all installed schedulers across the 10 cron-bearing queues.
   * Used by the admin /v1/admin/queues/stats endpoint and the Step 7 verifier.
   */
  async getSchedulers(): Promise<
    Array<{
      id: string;
      queue: QueueName;
      pattern: string;
      next: string | null;
      tz: string;
    }>
  > {
    const results: Array<{
      id: string;
      queue: QueueName;
      pattern: string;
      next: string | null;
      tz: string;
    }> = [];
    for (const [queueName, queue] of this.queues.entries()) {
      const schedulers = await queue.getJobSchedulers();
      for (const s of schedulers) {
        results.push({
          id: s.key ?? s.name ?? '',
          queue: queueName,
          pattern: s.pattern ?? '',
          next: s.next ? new Date(Number(s.next)).toISOString() : null,
          tz: s.tz ?? IST_TZ,
        });
      }
    }
    return results;
  }

  async onApplicationShutdown(): Promise<void> {
    // Queues are closed by BullModule lifecycle — nothing to do here.
  }
}
