/**
 * AnalyticsService — Step 22 (SPEC §6.25, §12).
 *
 * Wraps `AnalyticsRepository` with:
 *   1. Role / scope enforcement (sanchalak → centre_ids only, city_admin
 *      → city_id, state/super → any).
 *   2. Redis caching with a 5-minute TTL per scope-tuple, since dashboards
 *      poll these endpoints heavily and the underlying mat views only
 *      change once a day.
 *
 * Cache key shape:
 *   jp:analytics:<view>:<role>:<scope-fingerprint>
 *
 * Cache invalidation is purely TTL-based; the nightly refresh job warms
 * a fresh result on the next read.
 */

import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { RedisService } from '../../core/redis/redis.service';
import { AnalyticsRepository } from '../../db/repositories/analytics.repository';

import type {
  AttendanceTrendRow,
  CentreEngagementRow,
  DonationsSummaryRow,
  MsvPipelineRow,
  NiyamCompletionRow,
  TierDistributionRow,
} from '../../db/repositories/analytics.repository';

const CACHE_TTL_SECONDS = 300;

export interface AnalyticsActor {
  user_id: string;
  role: Role;
  city_id?: string;
  centre_ids?: string[];
}

export interface AnalyticsOverview {
  active_students: number;
  centres: number;
  open_service_requests: number;
  attendance_rate_30d: number;
  punya_awarded_30d: number;
  msv_active: number;
  donations_total_paise_ytd: number;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly repo: AnalyticsRepository,
    private readonly redis: RedisService,
  ) {}

  // ===========================================================================
  // Overview KPI cards
  // ===========================================================================

  async overview(actor: AnalyticsActor): Promise<AnalyticsOverview> {
    this.assertAdmin(actor.role);
    const cacheKey = this.cacheKey('overview', actor);
    const hit = await this.fromCache<AnalyticsOverview>(cacheKey);
    if (hit) return hit;

    // Fan a few cheap reads in parallel.
    const [engagement, attendance, msv, donations, distribution] = await Promise.all([
      this.repo.centreEngagement(this.scopeArgs(actor, { months: 1 })),
      this.repo.attendanceTrends(this.scopeArgs(actor, { days: 30 })),
      this.repo.msvPipeline(this.scopeArgs(actor)),
      this.repo.donationsSummary(this.scopeArgs(actor)),
      this.repo.punyaDistribution(this.scopeArgs(actor)),
    ]);

    const activeStudents = engagement.reduce((acc, r) => acc + r.active_students, 0);
    const centresInScope = new Set(engagement.map((r) => r.centre_id)).size;
    const totalMarks = attendance.reduce((a, r) => a + r.total_marks, 0);
    const presentMarks = attendance.reduce((a, r) => a + r.present_count, 0);
    const attendanceRate30d =
      totalMarks > 0 ? Math.round((presentMarks / totalMarks) * 1000) / 10 : 0;
    const punyaAwarded30d = engagement.reduce((a, r) => a + r.total_punya_awarded, 0);
    const msvActive = msv
      .filter((r) => r.msv_status === 'approved')
      .reduce((a, r) => a + r.student_count, 0);
    const donationsYtd = donations.reduce((a, r) => a + Number(r.total_paise), 0);

    const out: AnalyticsOverview = {
      active_students: activeStudents,
      centres: centresInScope,
      open_service_requests: 0, // filled by the controller from ServiceRequestsRepository
      attendance_rate_30d: attendanceRate30d,
      punya_awarded_30d: punyaAwarded30d,
      msv_active: msvActive,
      donations_total_paise_ytd: donationsYtd,
      // We surface a tiny tier-distribution payload alongside the overview
      // so the dashboard can render a Recharts donut without a second call.
    };
    // Side-channel: include the distribution under a property so the
    // controller can pluck it without re-reading.
    (out as unknown as Record<string, unknown>).tier_distribution = distribution;

    await this.toCache(cacheKey, out);
    return out;
  }

  // ===========================================================================
  // Detail views
  // ===========================================================================

  async attendance(actor: AnalyticsActor, days = 30): Promise<AttendanceTrendRow[]> {
    this.assertAdmin(actor.role);
    const cacheKey = this.cacheKey('attendance', actor, { days });
    const hit = await this.fromCache<AttendanceTrendRow[]>(cacheKey);
    if (hit) return hit;
    const rows = await this.repo.attendanceTrends(this.scopeArgs(actor, { days }));
    await this.toCache(cacheKey, rows);
    return rows;
  }

  async engagement(actor: AnalyticsActor, months = 6): Promise<CentreEngagementRow[]> {
    this.assertAdmin(actor.role);
    const cacheKey = this.cacheKey('engagement', actor, { months });
    const hit = await this.fromCache<CentreEngagementRow[]>(cacheKey);
    if (hit) return hit;
    const rows = await this.repo.centreEngagement(this.scopeArgs(actor, { months }));
    await this.toCache(cacheKey, rows);
    return rows;
  }

  async tierDistribution(actor: AnalyticsActor): Promise<TierDistributionRow[]> {
    this.assertAdmin(actor.role);
    const cacheKey = this.cacheKey('tier_distribution', actor);
    const hit = await this.fromCache<TierDistributionRow[]>(cacheKey);
    if (hit) return hit;
    const rows = await this.repo.punyaDistribution(this.scopeArgs(actor));
    await this.toCache(cacheKey, rows);
    return rows;
  }

  async msvPipeline(actor: AnalyticsActor): Promise<MsvPipelineRow[]> {
    this.assertAdmin(actor.role);
    const cacheKey = this.cacheKey('msv_pipeline', actor);
    const hit = await this.fromCache<MsvPipelineRow[]>(cacheKey);
    if (hit) return hit;
    const rows = await this.repo.msvPipeline(this.scopeArgs(actor));
    await this.toCache(cacheKey, rows);
    return rows;
  }

  async niyamCompletion(actor: AnalyticsActor): Promise<NiyamCompletionRow[]> {
    this.assertAdmin(actor.role);
    const cacheKey = this.cacheKey('niyam_completion', actor);
    const hit = await this.fromCache<NiyamCompletionRow[]>(cacheKey);
    if (hit) return hit;
    const rows = await this.repo.niyamCompletion(this.scopeArgs(actor));
    await this.toCache(cacheKey, rows);
    return rows;
  }

  async donationsSummary(
    actor: AnalyticsActor,
    opts: { financial_year?: string } = {},
  ): Promise<DonationsSummaryRow[]> {
    this.assertAdmin(actor.role);
    const cacheKey = this.cacheKey('donations_summary', actor, opts);
    const hit = await this.fromCache<DonationsSummaryRow[]>(cacheKey);
    if (hit) return hit;
    const args: { city_id?: string; financial_year?: string } = this.scopeArgs(actor);
    if (opts.financial_year) args.financial_year = opts.financial_year;
    const rows = await this.repo.donationsSummary(args);
    await this.toCache(cacheKey, rows);
    return rows;
  }

  // ===========================================================================
  // Refresh entry point — called by the analytics.refresh_views cron worker.
  // ===========================================================================

  async refreshAllViews(): Promise<{
    refreshed: string[];
    failed: string[];
    durationMs: number;
  }> {
    const result = await this.repo.refreshAll();
    this.logger.log(
      `analytics views refreshed: ${result.refreshed.length} ok, ${result.failed.length} failed in ${result.durationMs}ms`,
    );
    return result;
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private assertAdmin(role: Role): void {
    const allowed: Role[] = ['sanchalak', 'city_admin', 'state_admin', 'super_admin'];
    if (!allowed.includes(role)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only sanchalak/admin can read analytics',
        statusCode: 403,
      });
    }
  }

  private scopeArgs(
    actor: AnalyticsActor,
    extra: { months?: number; days?: number } = {},
  ): { city_id?: string; centre_ids?: string[]; months?: number; days?: number } {
    const args: { city_id?: string; centre_ids?: string[]; months?: number; days?: number } = {};
    if (actor.role === 'super_admin' || actor.role === 'state_admin') {
      // No scope filter (state_admin is loosely scoped by spec; tighten when
      // state→city seeds land).
    } else if (actor.role === 'city_admin' && actor.city_id) {
      args.city_id = actor.city_id;
    } else if (actor.role === 'sanchalak' && actor.centre_ids && actor.centre_ids.length > 0) {
      args.centre_ids = actor.centre_ids;
    } else if (actor.city_id) {
      args.city_id = actor.city_id;
    }
    if (extra.months !== undefined) args.months = extra.months;
    if (extra.days !== undefined) args.days = extra.days;
    return args;
  }

  private cacheKey(
    view: string,
    actor: AnalyticsActor,
    extra: Record<string, unknown> = {},
  ): string {
    const scopeFp = createHash('sha1')
      .update(
        JSON.stringify({
          r: actor.role,
          c: actor.city_id ?? null,
          ce: actor.centre_ids ?? null,
          x: extra,
        }),
      )
      .digest('hex')
      .slice(0, 16);
    return `analytics:${view}:${scopeFp}`;
  }

  private async fromCache<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.cacheClient.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(`cache get failed for ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  private async toCache(key: string, value: unknown): Promise<void> {
    try {
      await this.redis.cacheClient.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`cache set failed for ${key}: ${(err as Error).message}`);
    }
  }
}
