/**
 * `notifications.monthly_reports` worker — Step 22.
 *
 * Cron entry on the 1st of every month at 02:00 IST. The handler does not
 * itself render any PDFs; it just fans out one `report.generation` job
 * per ACTIVE student (Q11 — inactive students are excluded) so the
 * report-generation worker can process them in parallel.
 */

import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../core/redis/redis.service';
import { ReportsService } from '../../modules/reports/reports.service';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

import type { Job } from 'bullmq';

export interface MonthlyReportsCronPayload {
  /** Optional override for "what month is this for?". Empty → previous month. */
  period_label?: string;
}

export interface MonthlyReportsCronResult {
  enqueued: number;
  period_label: string;
}

@Injectable()
@Processor(QUEUES.NOTIFICATIONS_MONTHLY_REPORTS, { concurrency: 1 })
export class NotificationsMonthlyReportsProcessor extends BaseProcessor<
  MonthlyReportsCronPayload,
  MonthlyReportsCronResult
> {
  private readonly localLogger = new Logger('notifications-monthly-reports');

  constructor(
    redis: RedisService,
    private readonly reports: ReportsService,
  ) {
    super(QUEUES.NOTIFICATIONS_MONTHLY_REPORTS, redis);
  }

  async handle(
    job: Job<MonthlyReportsCronPayload, MonthlyReportsCronResult>,
  ): Promise<MonthlyReportsCronResult> {
    const periodLabel = job.data.period_label;
    const out = await this.reports.enqueueMonthlyForAllActive(periodLabel);
    this.localLogger.log(`monthly cron enqueued=${out.enqueued} period=${out.period_label}`);
    return out;
  }
}
