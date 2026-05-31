/**
 * `punya.leaderboard.refresh` — recompute one ZSET in Redis from the ledger.
 *
 * Payload shape (loose JSON since BullMQ encodes plain objects):
 *   { scope: 'batch'|'centre'|'city'|'national'|'msv',
 *     scope_id?: string | null,
 *     period?: 'YYYY-MM',
 *     window_days?: number }
 *
 * Concurrency: 1. The same `jobId` collapses duplicate enqueues from the
 * Punya service's debounce table; concurrency 1 means even if two pods both
 * race past their debounce, only one rebuild runs at a time per worker.
 *
 * On the every-5-minute cron tick (`punya.leaderboard.refresh.5min`), we
 * enumerate "active" scopes from the database and rebuild each one — this
 * is what keeps the leaderboard fresh when no awards have fired recently
 * (e.g. an out-of-date period after a backfill).
 */

import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { RedisService } from '../../core/redis/redis.service';
import { LeaderboardService, thisPeriod } from '../../modules/punya/leaderboard.service';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

import type { LeaderboardScope } from '../../modules/punya/punya.types';
import type { Job } from 'bullmq';

interface RefreshJobData {
  scope?: LeaderboardScope;
  scope_id?: string | null;
  period?: string;
  window_days?: number;
  /** When set to 'monthly_reset' the worker snapshots prior-month ZSETs. */
  job_kind?: 'refresh' | 'monthly_reset';
}

interface RefreshJobResult {
  rebuilt: Array<{ scope: LeaderboardScope; scope_id: string | null; member_count: number }>;
  period: string;
}

@Injectable()
@Processor(QUEUES.PUNYA_LEADERBOARD_REFRESH, { concurrency: 1 })
export class PunyaLeaderboardRefreshProcessor extends BaseProcessor<
  RefreshJobData,
  RefreshJobResult
> {
  protected readonly postLogger = new Logger('Worker:punya.leaderboard.refresh');

  constructor(
    redis: RedisService,
    private readonly drizzle: DrizzleService,
    private readonly leaderboards: LeaderboardService,
  ) {
    super(QUEUES.PUNYA_LEADERBOARD_REFRESH, redis);
  }

  async handle(job: Job<RefreshJobData, RefreshJobResult>): Promise<RefreshJobResult> {
    const data = job.data ?? {};
    const period = data.period ?? thisPeriod();
    const rebuilt: RefreshJobResult['rebuilt'] = [];

    // Monthly reset — snapshot the prior month then DEL its ZSETs.
    if (data.job_kind === 'monthly_reset') {
      const priorPeriod = priorPeriodFor(new Date());
      const snapshots = await this.snapshotAllScopesForPeriod(priorPeriod);
      this.postLogger.log(
        `monthly_reset complete: snapshotted ${snapshots.length} ZSETs for period=${priorPeriod}`,
      );
      return {
        rebuilt: snapshots.map((s) => ({
          scope: s.scope,
          scope_id: s.scope_id,
          member_count: s.member_count,
        })),
        period: priorPeriod,
      };
    }

    // 1. Targeted refresh — payload names one scope/id.
    if (data.scope) {
      const out = await this.leaderboards.rebuildScope({
        scope: data.scope,
        scope_id: data.scope_id ?? null,
        period,
        ...(data.window_days ? { windowDays: data.window_days } : {}),
      });
      rebuilt.push({
        scope: data.scope,
        scope_id: data.scope_id ?? null,
        member_count: out.member_count,
      });
      return { rebuilt, period };
    }

    // 2. Cron tick (no payload) — refresh "active" scopes. We enumerate
    //    cities + centres + batches that have had at least one Punya award
    //    in the last 30 days. That keeps the worker cheap during low
    //    activity and complete during high activity.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sinceIso = since.toISOString();
    const scopeRows = (await this.drizzle.dbRead.execute(
      sql`SELECT DISTINCT
            city_id, centre_id, batch_id
          FROM punya_transactions
         WHERE awarded_at > ${sinceIso}`,
    )) as unknown as Array<{
      city_id: string | null;
      centre_id: string | null;
      batch_id: string | null;
    }>;

    const cityIds = new Set<string>();
    const centreIds = new Set<string>();
    const batchIds = new Set<string>();
    for (const r of scopeRows) {
      if (r.city_id) cityIds.add(r.city_id);
      if (r.centre_id) centreIds.add(r.centre_id);
      if (r.batch_id) batchIds.add(r.batch_id);
    }

    for (const id of batchIds) {
      const out = await this.leaderboards.rebuildScope({
        scope: 'batch',
        scope_id: id,
        period,
      });
      rebuilt.push({ scope: 'batch', scope_id: id, member_count: out.member_count });
    }
    for (const id of centreIds) {
      const out = await this.leaderboards.rebuildScope({
        scope: 'centre',
        scope_id: id,
        period,
      });
      rebuilt.push({ scope: 'centre', scope_id: id, member_count: out.member_count });
    }
    for (const id of cityIds) {
      const cityOut = await this.leaderboards.rebuildScope({
        scope: 'city',
        scope_id: id,
        period,
      });
      rebuilt.push({ scope: 'city', scope_id: id, member_count: cityOut.member_count });
      const msvOut = await this.leaderboards.rebuildScope({
        scope: 'msv',
        scope_id: id,
        period,
      });
      rebuilt.push({ scope: 'msv', scope_id: id, member_count: msvOut.member_count });
    }
    const nationalOut = await this.leaderboards.rebuildScope({
      scope: 'national',
      scope_id: null,
      period,
    });
    rebuilt.push({
      scope: 'national',
      scope_id: null,
      member_count: nationalOut.member_count,
    });

    this.postLogger.log(
      `cron refresh complete: ${rebuilt.length} ZSETs rebuilt for period=${period}`,
    );
    return { rebuilt, period };
  }

  /**
   * Snapshot every "active" ZSET for the given (prior) period. Active is
   * inferred from ledger rows in the period: any (city / centre / batch)
   * that received Punya awards in the period gets snapshotted.
   */
  private async snapshotAllScopesForPeriod(
    period: string,
  ): Promise<Array<{ scope: LeaderboardScope; scope_id: string | null; member_count: number }>> {
    const [year, month] = period.split('-').map(Number);
    const start = new Date(Date.UTC(year!, (month ?? 1) - 1, 1));
    const end = new Date(Date.UTC(year!, month ?? 1, 1));
    const startIso = start.toISOString();
    const endIso = end.toISOString();
    const rows = (await this.drizzle.dbRead.execute(
      sql`SELECT DISTINCT city_id, centre_id, batch_id
            FROM punya_transactions
           WHERE awarded_at >= ${startIso}
             AND awarded_at < ${endIso}`,
    )) as unknown as Array<{
      city_id: string | null;
      centre_id: string | null;
      batch_id: string | null;
    }>;

    const cityIds = new Set<string>();
    const centreIds = new Set<string>();
    const batchIds = new Set<string>();
    for (const r of rows) {
      if (r.city_id) cityIds.add(r.city_id);
      if (r.centre_id) centreIds.add(r.centre_id);
      if (r.batch_id) batchIds.add(r.batch_id);
    }

    const results: Array<{
      scope: LeaderboardScope;
      scope_id: string | null;
      member_count: number;
    }> = [];
    for (const id of batchIds) {
      const r = await this.leaderboards.snapshotAndReset({
        scope: 'batch',
        scope_id: id,
        period,
      });
      results.push({ scope: 'batch', scope_id: id, member_count: r.member_count });
    }
    for (const id of centreIds) {
      const r = await this.leaderboards.snapshotAndReset({
        scope: 'centre',
        scope_id: id,
        period,
      });
      results.push({ scope: 'centre', scope_id: id, member_count: r.member_count });
    }
    for (const id of cityIds) {
      const city = await this.leaderboards.snapshotAndReset({
        scope: 'city',
        scope_id: id,
        period,
      });
      results.push({ scope: 'city', scope_id: id, member_count: city.member_count });
      const msv = await this.leaderboards.snapshotAndReset({
        scope: 'msv',
        scope_id: id,
        period,
      });
      results.push({ scope: 'msv', scope_id: id, member_count: msv.member_count });
    }
    const national = await this.leaderboards.snapshotAndReset({
      scope: 'national',
      scope_id: null,
      period,
    });
    results.push({
      scope: 'national',
      scope_id: null,
      member_count: national.member_count,
    });
    return results;
  }
}

/**
 * Return the YYYY-MM string of the previous month, based on the supplied
 * date (defaults to now). Used by the monthly reset cron which fires on the
 * 1st at 00:05 IST and needs to address the just-finished month.
 */
function priorPeriodFor(d: Date): string {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0..11 — already "previous" relative to month+1
  const prior = new Date(Date.UTC(year, month - 1, 1));
  const py = prior.getUTCFullYear();
  const pm = String(prior.getUTCMonth() + 1).padStart(2, '0');
  return `${py}-${pm}`;
}
