/**
 * PunyaReconcileService — nightly drift detection + repair.
 *
 * SPEC §8.5: "Reconciliation job (nightly): re-aggregates ledger and
 * corrects any drift in punya_balances."
 *
 * Flow:
 *   1. detectBalanceDrift() — sums every student's ledger entries and
 *      compares to the projection row. Returns the delta rows.
 *   2. For each drift row, call repairBalance() inside its own transaction.
 *   3. Persist a run record (in Redis for now — full audit row lands in the
 *      audit_logs table via this.audit.emit).
 *   4. If the number of affected students > ALERT_THRESHOLD, log an error
 *      and fire a notifications.fanout job to the on-call list (super_admin
 *      users in the deployment) so they know something's wrong.
 *
 * Triggered by:
 *   - Daily cron at 03:00 IST (already in scheduler.service.ts for the
 *     QUEUES.PUNYA_RECONCILE queue).
 *   - `POST /v1/admin/punya/reconcile` (super_admin manual run).
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';

import { RedisService } from '../../core/redis/redis.service';
import { PunyaTransactionsRepository } from '../../db/repositories';
import { QUEUES } from '../../queues/queues.constants';
import { AuditService } from '../audit/audit.service';

export interface ReconcileRunReport {
  run_id: string;
  started_at: string;
  finished_at: string;
  drift_count: number;
  drift_students: string[];
  alerted: boolean;
  source: 'cron' | 'manual_admin';
  details: Array<{
    student_id: string;
    before_total: number;
    after_total: number;
    drift_total: number;
  }>;
}

@Injectable()
export class PunyaReconcileService {
  private readonly logger = new Logger(PunyaReconcileService.name);
  /** > N affected students fires an ops alert. SPEC: "alert if >10 students affected". */
  private static readonly ALERT_THRESHOLD = 10;
  private static readonly LAST_RUN_KEY = 'punya:reconcile:last_run';
  /** Last 50 runs are retained for the audit page. */
  private static readonly RUN_HISTORY_KEY = 'punya:reconcile:history';

  constructor(
    private readonly transactions: PunyaTransactionsRepository,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    @Optional()
    @Inject(`BullQueue_${QUEUES.NOTIFICATIONS_FANOUT}`)
    private readonly fanoutQueue: Queue | null,
  ) {}

  async runOnce(opts: { source: 'cron' | 'manual_admin' }): Promise<ReconcileRunReport> {
    const startedAt = new Date();
    const runId = `recon-${startedAt.toISOString()}-${Math.random().toString(36).slice(2, 8)}`;

    const drift = await this.transactions.detectBalanceDrift();
    const details: ReconcileRunReport['details'] = [];

    for (const row of drift) {
      const repaired = await this.transactions.repairBalance(row.student_id);
      details.push({
        student_id: row.student_id,
        before_total: row.projection_total,
        after_total: repaired.total_points,
        drift_total: row.drift_total,
      });
    }

    const finishedAt = new Date();
    const alerted = drift.length > PunyaReconcileService.ALERT_THRESHOLD;

    const report: ReconcileRunReport = {
      run_id: runId,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      drift_count: drift.length,
      drift_students: drift.map((d) => d.student_id),
      alerted,
      source: opts.source,
      details,
    };

    // Persist last-run + history in Redis for the audit page.
    await this.redis.cacheClient.set(
      PunyaReconcileService.LAST_RUN_KEY,
      JSON.stringify(report),
      'EX',
      30 * 24 * 60 * 60,
    );
    await this.redis.cacheClient.lpush(
      PunyaReconcileService.RUN_HISTORY_KEY,
      JSON.stringify({
        run_id: runId,
        started_at: report.started_at,
        drift_count: report.drift_count,
        alerted,
        source: opts.source,
      }),
    );
    await this.redis.cacheClient.ltrim(PunyaReconcileService.RUN_HISTORY_KEY, 0, 49);

    // Audit log for ops.
    await this.audit
      .emit({
        actor_user_id: 'system',
        actor_role: 'super_admin',
        action: 'reconcile',
        entity_kind: 'punya_balances',
        entity_id: runId,
        after: {
          drift_count: drift.length,
          alerted,
          source: opts.source,
          drift_students: drift.map((d) => d.student_id).slice(0, 20),
        },
      })
      .catch(() => undefined);

    if (alerted && this.fanoutQueue) {
      this.logger.error(
        `[punya.reconcile] ALERT: ${drift.length} students with drift (> ${PunyaReconcileService.ALERT_THRESHOLD})`,
      );
      // We don't yet have an on-call user list; we emit an alert event the
      // notifications fanout worker can route to super_admin recipients.
      await this.fanoutQueue
        .add('punya.reconcile.alert', {
          event: 'punya.reconcile.alert',
          recipient_user_ids: [], // fanout worker resolves super_admins
          source: { kind: 'punya_reconcile', id: runId },
          data: {
            drift_count: drift.length,
            threshold: PunyaReconcileService.ALERT_THRESHOLD,
            run_id: runId,
            sample_students: drift.slice(0, 5).map((d) => ({
              student_id: d.student_id,
              drift_total: d.drift_total,
            })),
          },
          deep_link: `/admin/punya/audit`,
        })
        .catch((err) => {
          this.logger.warn(`reconcile alert enqueue failed: ${(err as Error).message}`);
        });
    } else {
      this.logger.log(
        `[punya.reconcile] drift_students=${drift.length} ${alerted ? '(alerted)' : '(below threshold)'}`,
      );
    }

    return report;
  }

  async getLastRun(): Promise<ReconcileRunReport | null> {
    const raw = await this.redis.cacheClient.get(PunyaReconcileService.LAST_RUN_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ReconcileRunReport;
    } catch {
      return null;
    }
  }

  async getRunHistory(limit = 20): Promise<
    Array<{
      run_id: string;
      started_at: string;
      drift_count: number;
      alerted: boolean;
      source: string;
    }>
  > {
    const rows = await this.redis.cacheClient.lrange(
      PunyaReconcileService.RUN_HISTORY_KEY,
      0,
      Math.max(0, limit - 1),
    );
    const out: Array<{
      run_id: string;
      started_at: string;
      drift_count: number;
      alerted: boolean;
      source: string;
    }> = [];
    for (const r of rows) {
      try {
        out.push(JSON.parse(r));
      } catch {
        /* skip malformed */
      }
    }
    return out;
  }
}
