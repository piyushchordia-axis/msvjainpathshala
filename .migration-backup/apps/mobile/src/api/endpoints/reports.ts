/**
 * Progress-report endpoint wrappers (SPEC §5.20 / Step 22) used by the parent
 * monthly-reports screen. Mirrors apps/api/src/modules/reports/*.
 *
 *   GET /v1/reports/me   released progress reports across the parent's children
 *
 * Parents only ever receive reports the shikshak has released
 * (released_to_parent = true); the backend filters this.
 */

import { api, unwrap } from '../client';

export interface ReportSnapshot {
  student?: {
    id: string;
    full_name: string;
    student_code: string;
    age_group: string;
  };
  period?: { kind: string; label: string; from: string; to: string };
  attendance?: { present: number; total: number; rate_pct: number };
  punya?: { points_awarded: number; reversals: number };
  highlights?: string[];
}

export interface ProgressReportRow {
  id: string;
  student_id: string;
  period_kind: string;
  period_label: string;
  generated_at: string;
  pdf_asset_id: string | null;
  shikshak_comment: string | null;
  released_to_parent: boolean;
  released_at: string | null;
  snapshot: ReportSnapshot;
}

export const reportsApi = {
  async listMine(): Promise<{ items: ProgressReportRow[] }> {
    return unwrap<{ items: ProgressReportRow[] }>(api.get('/v1/reports/me'));
  },
};
