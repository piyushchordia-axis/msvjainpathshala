/**
 * `analytics.refresh_views` worker — SPEC §12.2.
 *
 * Cron-driven (04:00 IST daily). Runs REFRESH MATERIALIZED VIEW
 * CONCURRENTLY for every analytics mv, falling back to a plain REFRESH
 * for views that haven't been populated yet (CONCURRENTLY requires the
 * view to have data + a unique index).
 */

import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../core/redis/redis.service';
import { AnalyticsService } from '../../modules/analytics/analytics.service';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

import type { Job } from 'bullmq';

export interface AnalyticsRefreshPayload {
  /** Cron passes no payload; kept for future explicit triggers. */
  view?: string;
}

export interface AnalyticsRefreshResult {
  refreshed: string[];
  failed: string[];
  duration_ms: number;
}

@Injectable()
@Processor(QUEUES.ANALYTICS_REFRESH_VIEWS, { concurrency: 1 })
export class AnalyticsRefreshViewsProcessor extends BaseProcessor<
  AnalyticsRefreshPayload,
  AnalyticsRefreshResult
> {
  private readonly localLogger = new Logger('analytics-refresh-views');

  constructor(
    redis: RedisService,
    private readonly analytics: AnalyticsService,
  ) {
    super(QUEUES.ANALYTICS_REFRESH_VIEWS, redis);
  }

  async handle(
    _job: Job<AnalyticsRefreshPayload, AnalyticsRefreshResult>,
  ): Promise<AnalyticsRefreshResult> {
    const out = await this.analytics.refreshAllViews();
    this.localLogger.log(
      `refreshed=${out.refreshed.length} failed=${out.failed.length} in ${out.durationMs}ms`,
    );
    return {
      refreshed: out.refreshed,
      failed: out.failed,
      duration_ms: out.durationMs,
    };
  }
}
