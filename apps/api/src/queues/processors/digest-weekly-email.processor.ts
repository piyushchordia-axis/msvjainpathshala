/**
 * `digest.weekly.email` worker — SPEC §12.7.
 *
 * Cron Monday 07:00 IST. Builds two digests:
 *   - For each city_admin: city-rollup metrics for the past week.
 *   - For each sanchalak: centre-rollup metrics for the past week.
 *
 * The metrics are pulled live (the mat views are nightly so the data we
 * see at Monday 07:00 was refreshed Sunday 04:00 — close enough for a
 * weekly digest). Emails fan out through notifications.fanout with a
 * digest.* event tag so the email worker can pick a template.
 */

import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { RedisService } from '../../core/redis/redis.service';
import { AnalyticsRepository } from '../../db/repositories/analytics.repository';
import { SanchalakAssignmentsRepository } from '../../db/repositories/sanchalak-assignments.repository';
import { ServiceRequestsRepository } from '../../db/repositories/service-requests.repository';
import { UsersRepository } from '../../db/repositories/users.repository';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

import type { Job } from 'bullmq';

export interface DigestPayload {
  /** Future: scope to a single city/centre for ad-hoc digests. */
  scope?: 'city' | 'centre';
  scope_id?: string;
}

export interface DigestResult {
  city_admin_count: number;
  sanchalak_count: number;
  enqueued: number;
}

@Injectable()
@Processor(QUEUES.DIGEST_WEEKLY_EMAIL, { concurrency: 1 })
export class DigestWeeklyEmailProcessor extends BaseProcessor<DigestPayload, DigestResult> {
  private readonly localLogger = new Logger('digest-weekly-email');

  constructor(
    redis: RedisService,
    private readonly analytics: AnalyticsRepository,
    private readonly serviceRequests: ServiceRequestsRepository,
    private readonly users: UsersRepository,
    private readonly sanchalakAssignments: SanchalakAssignmentsRepository,
    @InjectQueue(QUEUES.NOTIFICATIONS_FANOUT) private readonly fanoutQueue: Queue,
  ) {
    super(QUEUES.DIGEST_WEEKLY_EMAIL, redis);
  }

  async handle(_job: Job<DigestPayload, DigestResult>): Promise<DigestResult> {
    const cityAdmins = await this.users.listByRole('city_admin').catch(() => []);
    const sanchalaks = await this.users.listByRole('sanchalak').catch(() => []);
    let enqueued = 0;

    for (const u of cityAdmins) {
      if (!u.email && !u.id) continue;
      const cityId = u.city_id ?? null;
      const att = cityId ? await this.analytics.attendanceTrends({ city_id: cityId, days: 7 }) : [];
      const open = cityId ? await this.serviceRequests.openCountByCity(cityId) : 0;
      await this.fanoutQueue
        .add('digest.weekly.city', {
          event: 'digest.weekly.city',
          recipient_user_ids: [u.id],
          recipient_emails: u.email ? [u.email] : [],
          source: { kind: 'digest', id: `city:${cityId ?? 'unknown'}` },
          data: {
            scope: 'city',
            attendance_days: att.length,
            attendance_avg_rate:
              att.length > 0
                ? Math.round(att.reduce((a, r) => a + r.attendance_rate, 0) / att.length)
                : 0,
            open_service_requests: open,
            week_label: this.weekLabel(),
          },
        })
        .catch((err) => this.localLogger.warn(`digest fanout failed: ${(err as Error).message}`));
      enqueued++;
    }

    for (const u of sanchalaks) {
      const centreIds = await this.sanchalakAssignments
        .listCentreIdsForSanchalak(u.id)
        .catch(() => []);
      if (centreIds.length === 0) continue;
      const engagement = await this.analytics.centreEngagement({
        centre_ids: centreIds,
        months: 1,
      });
      await this.fanoutQueue
        .add('digest.weekly.centre', {
          event: 'digest.weekly.centre',
          recipient_user_ids: [u.id],
          recipient_emails: u.email ? [u.email] : [],
          source: { kind: 'digest', id: `sanchalak:${u.id}` },
          data: {
            scope: 'centre',
            centres: centreIds.length,
            attendance_rate:
              engagement.length > 0
                ? Math.round(
                    engagement.reduce((a, r) => a + r.attendance_rate, 0) / engagement.length,
                  )
                : 0,
            punya_awarded: engagement.reduce((a, r) => a + r.total_punya_awarded, 0),
            week_label: this.weekLabel(),
          },
        })
        .catch((err) => this.localLogger.warn(`digest fanout failed: ${(err as Error).message}`));
      enqueued++;
    }

    this.localLogger.log(
      `digest enqueued — city_admins=${cityAdmins.length} sanchalaks=${sanchalaks.length} jobs=${enqueued}`,
    );
    return {
      city_admin_count: cityAdmins.length,
      sanchalak_count: sanchalaks.length,
      enqueued,
    };
  }

  private weekLabel(): string {
    const now = new Date();
    const start = new Date(now);
    start.setUTCDate(now.getUTCDate() - 7);
    return `${start.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)}`;
  }
}
