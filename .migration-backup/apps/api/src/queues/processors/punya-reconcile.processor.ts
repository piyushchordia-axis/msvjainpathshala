/**
 * `punya.reconcile` — nightly ledger / projection reconciliation.
 *
 * Delegates to `PunyaReconcileService.runOnce()` which:
 *   1. Sums every student's ledger and compares to projection.
 *   2. Repairs each drift row inside its own tx.
 *   3. Persists last-run report + history into Redis (audit page reads this).
 *   4. If drift > threshold (10), enqueues a notifications.fanout alert.
 *
 * Concurrency 1 — the underlying tx writes are short but the read pass walks
 * the full ledger; we don't want two concurrent passes stepping on each other.
 *
 * Cron: 03:00 IST daily, installed by `scheduler.service.ts`.
 */

import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../core/redis/redis.service';
import { PunyaReconcileService } from '../../modules/punya/punya-reconcile.service';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

import type { Job } from 'bullmq';

interface ReconcileJobData {
  source?: 'cron' | 'manual_admin';
}

interface ReconcileJobResult {
  run_id: string;
  drift_count: number;
  alerted: boolean;
  source: string;
}

@Injectable()
@Processor(QUEUES.PUNYA_RECONCILE, { concurrency: 1 })
export class PunyaReconcileProcessor extends BaseProcessor<ReconcileJobData, ReconcileJobResult> {
  protected readonly postLogger = new Logger('Worker:punya.reconcile');

  constructor(
    redis: RedisService,
    private readonly reconcile: PunyaReconcileService,
  ) {
    super(QUEUES.PUNYA_RECONCILE, redis);
  }

  async handle(job: Job<ReconcileJobData, ReconcileJobResult>): Promise<ReconcileJobResult> {
    const source = (job.data?.source ?? 'cron') as 'cron' | 'manual_admin';
    const report = await this.reconcile.runOnce({ source });
    return {
      run_id: report.run_id,
      drift_count: report.drift_count,
      alerted: report.alerted,
      source: report.source,
    };
  }
}
