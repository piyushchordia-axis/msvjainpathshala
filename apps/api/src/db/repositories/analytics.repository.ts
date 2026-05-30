/**
 * AnalyticsRepository — reads from the six materialised views created in
 * migration 0017 (SPEC §12.2):
 *
 *   mv_centre_engagement (centre_id, academic_month, ...)
 *   mv_punya_distribution (city_id, tier, student_count)
 *   mv_msv_pipeline       (city_id, msv_status, student_count, last_decision_at)
 *   mv_attendance_trends  (city_id, day, present_count, total_marks, attendance_rate)
 *   mv_niyam_completion   (city_id, niyam_id, approved_count, rejected_count, ...)
 *   mv_donations_summary  (financial_year, city_id, donation_count, total_paise, eighty_g_count)
 *
 * REFRESH MATERIALIZED VIEW CONCURRENTLY is invoked from
 * `AnalyticsRefreshViewsProcessor` (cron at 04:00 IST). The unique index
 * on each view's primary group-by columns is what enables CONCURRENTLY —
 * it's NOT optional.
 */

import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';

export interface CentreEngagementRow {
  centre_id: string;
  academic_month: string;
  attendance_rate: number;
  homework_completion_rate: number;
  niyam_completion_rate: number;
  total_punya_awarded: number;
  active_students: number;
}

export interface TierDistributionRow {
  city_id: string;
  tier: 'jigyasu' | 'shravak' | 'sadhak' | 'shraman' | 'tirthankar';
  student_count: number;
}

export interface MsvPipelineRow {
  city_id: string;
  msv_status: string;
  student_count: number;
  last_decision_at: string | null;
}

export interface AttendanceTrendRow {
  city_id: string;
  day: string;
  present_count: number;
  total_marks: number;
  attendance_rate: number;
}

export interface NiyamCompletionRow {
  city_id: string;
  niyam_id: string;
  approved_count: number;
  rejected_count: number;
  submission_count: number;
}

export interface DonationsSummaryRow {
  financial_year: string;
  city_id: string;
  donation_count: number;
  total_paise: number;
  eighty_g_count: number;
}

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  // -------------------------------------------------------------------------
  // Reads (cached at the service layer for 5 min)
  // -------------------------------------------------------------------------

  async centreEngagement(opts: {
    city_id?: string;
    centre_ids?: string[];
    months?: number;
  }): Promise<CentreEngagementRow[]> {
    const monthsBack = opts.months ?? 6;
    const rows = await this.drizzle.dbRead.execute(sql`
      SELECT mv.centre_id, mv.academic_month,
             mv.attendance_rate::float AS attendance_rate,
             mv.homework_completion_rate::float AS homework_completion_rate,
             mv.niyam_completion_rate::float AS niyam_completion_rate,
             mv.total_punya_awarded::int AS total_punya_awarded,
             mv.active_students::int AS active_students
        FROM mv_centre_engagement mv
        JOIN centres c ON c.id = mv.centre_id
       WHERE mv.academic_month >= to_char(now() - (${monthsBack}::text || ' months')::interval, 'YYYY-MM')
         ${opts.city_id ? sql`AND c.city_id = ${opts.city_id}` : sql``}
         ${
           opts.centre_ids && opts.centre_ids.length > 0
             ? sql`AND mv.centre_id = ANY(ARRAY[${sql.join(
                 opts.centre_ids.map((id) => sql`${id}`),
                 sql`, `,
               )}]::uuid[])`
             : sql``
         }
       ORDER BY mv.centre_id, mv.academic_month
    `);
    return rows as unknown as CentreEngagementRow[];
  }

  async punyaDistribution(opts: { city_id?: string }): Promise<TierDistributionRow[]> {
    const rows = await this.drizzle.dbRead.execute(sql`
      SELECT city_id::text AS city_id,
             tier,
             student_count::int AS student_count
        FROM mv_punya_distribution
       ${opts.city_id ? sql`WHERE city_id = ${opts.city_id}` : sql``}
       ORDER BY city_id, tier
    `);
    return rows as unknown as TierDistributionRow[];
  }

  async msvPipeline(opts: { city_id?: string }): Promise<MsvPipelineRow[]> {
    const rows = await this.drizzle.dbRead.execute(sql`
      SELECT city_id::text AS city_id,
             msv_status,
             student_count::int AS student_count,
             last_decision_at
        FROM mv_msv_pipeline
       ${opts.city_id ? sql`WHERE city_id = ${opts.city_id}` : sql``}
       ORDER BY msv_status
    `);
    return rows as unknown as MsvPipelineRow[];
  }

  async attendanceTrends(opts: { city_id?: string; days?: number }): Promise<AttendanceTrendRow[]> {
    const days = opts.days ?? 30;
    const rows = await this.drizzle.dbRead.execute(sql`
      SELECT city_id::text AS city_id,
             to_char(day, 'YYYY-MM-DD') AS day,
             present_count::int AS present_count,
             total_marks::int AS total_marks,
             attendance_rate::float AS attendance_rate
        FROM mv_attendance_trends
       WHERE day >= (CURRENT_DATE - (${days}::text || ' days')::interval)::date
         ${opts.city_id ? sql`AND city_id = ${opts.city_id}` : sql``}
       ORDER BY day
    `);
    return rows as unknown as AttendanceTrendRow[];
  }

  async niyamCompletion(opts: { city_id?: string }): Promise<NiyamCompletionRow[]> {
    const rows = await this.drizzle.dbRead.execute(sql`
      SELECT city_id::text AS city_id,
             niyam_id::text AS niyam_id,
             approved_count::int AS approved_count,
             rejected_count::int AS rejected_count,
             submission_count::int AS submission_count
        FROM mv_niyam_completion
       ${opts.city_id ? sql`WHERE city_id = ${opts.city_id}` : sql``}
       ORDER BY submission_count DESC
       LIMIT 50
    `);
    return rows as unknown as NiyamCompletionRow[];
  }

  async donationsSummary(opts: {
    city_id?: string;
    financial_year?: string;
  }): Promise<DonationsSummaryRow[]> {
    const rows = await this.drizzle.dbRead.execute(sql`
      SELECT financial_year,
             city_id::text AS city_id,
             donation_count::int AS donation_count,
             total_paise::bigint AS total_paise,
             eighty_g_count::int AS eighty_g_count
        FROM mv_donations_summary
       WHERE 1=1
         ${opts.city_id ? sql`AND city_id = ${opts.city_id}` : sql``}
         ${opts.financial_year ? sql`AND financial_year = ${opts.financial_year}` : sql``}
       ORDER BY financial_year DESC, city_id
    `);
    return rows as unknown as DonationsSummaryRow[];
  }

  // -------------------------------------------------------------------------
  // Refresh — invoked by analytics.refresh_views cron worker
  // -------------------------------------------------------------------------

  /**
   * Run REFRESH MATERIALIZED VIEW CONCURRENTLY across all six views.
   * CONCURRENTLY needs a UNIQUE INDEX on every column referenced by the
   * view's identity — migration 0017 creates those indexes alongside each
   * CREATE MATERIALIZED VIEW. Without CONCURRENTLY, the table would be
   * exclusively locked for the duration of the refresh, blocking the
   * dashboard reads.
   */
  async refreshAll(): Promise<{ refreshed: string[]; failed: string[]; durationMs: number }> {
    const start = Date.now();
    const views = [
      'mv_centre_engagement',
      'mv_punya_distribution',
      'mv_msv_pipeline',
      'mv_attendance_trends',
      'mv_niyam_completion',
      'mv_donations_summary',
    ];
    const refreshed: string[] = [];
    const failed: string[] = [];
    for (const v of views) {
      try {
        await this.drizzle.db.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${v}`));
        refreshed.push(v);
      } catch (err) {
        // CONCURRENTLY requires the view to have been populated at least
        // once. Fall back to a plain REFRESH for the initial run.
        try {
          await this.drizzle.db.execute(sql.raw(`REFRESH MATERIALIZED VIEW ${v}`));
          refreshed.push(v);
        } catch {
          failed.push(v);
        }
        void err;
      }
    }
    return { refreshed, failed, durationMs: Date.now() - start };
  }
}
