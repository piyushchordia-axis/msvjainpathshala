/**
 * Documents endpoint wrappers (parent-facing): digital ID card + downloadable
 * progress-report PDFs. The backend renders PDFs synchronously and returns a
 * short-lived signed URL the app opens via Linking.
 */

import { api, unwrap } from '../client';

export interface DigitalIdCardDto {
  id: string;
  student_id: string;
  card_number: string;
  qr_payload: string;
  msv_badge: boolean;
  version_no: number;
  generated_at: string;
}

export interface IdCardResult {
  card: DigitalIdCardDto;
  url: string;
}

export interface ReportDownloadResult {
  report: {
    id: string;
    student_id: string;
    period_kind: 'monthly' | 'termly';
    period_label: string;
    released_to_parent: boolean;
  };
  url: string;
}

export const documentsApi = {
  /** Generate (or fetch) the child's digital ID card + a signed PDF URL. */
  async getIdCard(studentId: string): Promise<IdCardResult> {
    return unwrap<IdCardResult>(api.get(`/v1/students/${studentId}/id-card`));
  },

  /** Signed download URL for a released progress-report PDF. */
  async downloadReport(reportId: string): Promise<ReportDownloadResult> {
    return unwrap<ReportDownloadResult>(api.get(`/v1/reports/${reportId}/download`));
  },
};
