/**
 * Niyam endpoint wrappers used by the parent / student-view niyam screens
 * (Step 17). Mirrors apps/api/src/modules/niyams/*.
 */

import { api, unwrap } from '../client';

export type NiyamType = 'daily' | 'weekly' | 'monthly';
export type ProofType = 'photo' | 'video' | 'either';

export interface NiyamAdminRow {
  id: string;
  title_en: string;
  title_hi: string;
  description_en: string | null;
  description_hi: string | null;
  type: NiyamType;
  start_date: string;
  end_date: string | null;
  proof_type: ProofType;
  points_value: number;
  msv_only: boolean;
  status: string;
  created_at: string;
}

export interface NiyamForCaller {
  id: string;
  title_en: string;
  title_hi: string;
  description_en: string | null;
  description_hi: string | null;
  type: NiyamType;
  proof_type: ProofType;
  points_value: number;
  start_date: string;
  end_date: string | null;
  msv_only: boolean;
  submitted_for_current_period: boolean;
}

export interface NiyamSubmissionRow {
  id: string;
  niyam_id: string;
  niyam_title_en: string;
  niyam_title_hi: string;
  niyam_type: NiyamType;
  points_value: number;
  status: 'auto_approved' | 'rejected';
  submitted_at: string;
  submission_date: string;
  proof_asset_id: string;
  rejected_at: string | null;
  rejection_reason: string | null;
}

export interface NiyamStreakDto {
  niyam_id: string;
  niyam_title_en: string;
  niyam_title_hi: string;
  current_streak: number;
  longest_streak: number;
  last_completion_date: string | null;
  badge_kind: string | null;
}

export interface SubmitNiyamResult {
  submission_id: string;
  status: 'auto_approved';
  punya_transaction_id: string;
  points_awarded: number;
  gallery_item_id: string | null;
  duplicate: boolean;
  submission_date: string;
}

/** Loose shape for the admin submission-review queue (defensive fields). */
export interface NiyamSubmissionForReview {
  id: string;
  student_name?: string;
  student_full_name?: string;
  niyam_title_en?: string;
  title_en?: string;
  status?: string;
  submitted_at?: string;
  submission_date?: string;
}

export const niyamsApi = {
  /** Admin niyam catalogue for shikshak+ (city-scoped server-side). */
  async listForAdmin(
    opts: { type?: NiyamType; limit?: number; offset?: number } = {},
  ): Promise<{ items: NiyamAdminRow[] }> {
    return unwrap<{ items: NiyamAdminRow[] }>(api.get('/v1/admin/niyams', { params: opts }));
  },

  async listForCaller(
    studentId: string,
    opts: { type?: NiyamType } = {},
  ): Promise<{ items: NiyamForCaller[] }> {
    return unwrap<{ items: NiyamForCaller[] }>(
      api.get('/v1/niyams', { params: { student_id: studentId, ...opts } }),
    );
  },

  async submit(
    niyamId: string,
    body: { student_id: string; proof_asset_id: string; client_op_id?: string },
  ): Promise<SubmitNiyamResult> {
    return unwrap<SubmitNiyamResult>(api.post(`/v1/niyams/${niyamId}/submissions`, body));
  },

  async recentForStudent(studentId: string, limit = 20): Promise<{ items: NiyamSubmissionRow[] }> {
    return unwrap<{ items: NiyamSubmissionRow[] }>(
      api.get(`/v1/students/${studentId}/niyams/recent`, { params: { limit } }),
    );
  },

  async streaksForStudent(studentId: string): Promise<{ items: NiyamStreakDto[] }> {
    return unwrap<{ items: NiyamStreakDto[] }>(api.get(`/v1/students/${studentId}/niyam-streaks`));
  },

  /** Admin submission review queue (shikshak+). */
  async listSubmissionsForReview(
    opts: { niyam_id?: string } = {},
  ): Promise<{ items: NiyamSubmissionForReview[] }> {
    return unwrap<{ items: NiyamSubmissionForReview[] }>(
      api.get('/v1/admin/niyam-submissions', { params: opts }),
    );
  },

  /** Reject a submission within the 30-day window (Q5). Reverses Punya. */
  async rejectSubmission(submissionId: string, reason: string): Promise<unknown> {
    return unwrap<unknown>(
      api.post(`/v1/admin/niyam-submissions/${submissionId}/reject`, { reason }),
    );
  },

  async setGalleryVisibility(
    optIn: boolean,
  ): Promise<{ gallery_visibility_opt_in: boolean; items_hidden: number; items_restored: number }> {
    return unwrap(api.patch('/v1/profile/gallery-visibility', { opt_in: optIn }));
  },
};
