/**
 * Admin analytics endpoint wrappers — SPEC §6.25.
 *
 * Powers the city/state/super/sanchalak dashboards and the reports tabs.
 * Every route is scoped server-side by the caller's JWT, so the client
 * just calls and renders whatever rows it gets back.
 *
 *   GET /v1/admin/analytics/overview           sanchalak+ (scoped)
 *   GET /v1/admin/analytics/attendance
 *   GET /v1/admin/analytics/engagement
 *   GET /v1/admin/analytics/tier-distribution
 *   GET /v1/admin/analytics/msv-pipeline
 *   GET /v1/admin/analytics/niyam-completion
 *   GET /v1/admin/analytics/donations
 */

import { api, unwrap } from '../client';

export type AnalyticsTier = 'jigyasu' | 'shravak' | 'sadhak' | 'shraman' | 'tirthankar';

export interface AnalyticsOverview {
  active_students: number;
  centres: number;
  open_service_requests: number;
  attendance_rate_30d: number;
  punya_awarded_30d: number;
  msv_active: number;
  donations_total_paise_ytd: number;
  tier_distribution?: TierDistributionRow[];
}

export interface AttendanceTrendRow {
  city_id: string;
  day: string;
  present_count: number;
  total_marks: number;
  attendance_rate: number;
}

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
  tier: AnalyticsTier;
  student_count: number;
}

export interface MsvPipelineRow {
  city_id: string;
  msv_status: string;
  student_count: number;
  last_decision_at: string | null;
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

export const analyticsApi = {
  async overview(): Promise<AnalyticsOverview> {
    return unwrap<AnalyticsOverview>(api.get('/v1/admin/analytics/overview'));
  },

  async attendance(days = 30): Promise<{ items: AttendanceTrendRow[] }> {
    return unwrap<{ items: AttendanceTrendRow[] }>(
      api.get('/v1/admin/analytics/attendance', { params: { days } }),
    );
  },

  async engagement(months = 6): Promise<{ items: CentreEngagementRow[] }> {
    return unwrap<{ items: CentreEngagementRow[] }>(
      api.get('/v1/admin/analytics/engagement', { params: { months } }),
    );
  },

  async tierDistribution(): Promise<{ items: TierDistributionRow[] }> {
    return unwrap<{ items: TierDistributionRow[] }>(
      api.get('/v1/admin/analytics/tier-distribution'),
    );
  },

  async msvPipeline(): Promise<{ items: MsvPipelineRow[] }> {
    return unwrap<{ items: MsvPipelineRow[] }>(api.get('/v1/admin/analytics/msv-pipeline'));
  },

  async niyamCompletion(): Promise<{ items: NiyamCompletionRow[] }> {
    return unwrap<{ items: NiyamCompletionRow[] }>(api.get('/v1/admin/analytics/niyam-completion'));
  },

  async donations(financialYear?: string): Promise<{ items: DonationsSummaryRow[] }> {
    return unwrap<{ items: DonationsSummaryRow[] }>(
      api.get('/v1/admin/analytics/donations', {
        params: financialYear ? { financial_year: financialYear } : {},
      }),
    );
  },
};
