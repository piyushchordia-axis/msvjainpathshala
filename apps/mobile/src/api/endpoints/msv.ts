/**
 * MSV programme endpoint wrappers (Step 10, Q1) used by the parent
 * "Apply for MSV" screen. Mirrors apps/api/src/modules/msv/*.
 *
 *   POST /v1/msv/enrolments   parent applies for own child
 *
 * The backend accepts exactly { student_id, note } (msvApplicationSchema in
 * @jp/shared) — Q1 means there are NO eligibility rules, the note just
 * captures intent the admin reads when deciding. Current MSV status per child
 * is read from StudentDto.msv_status (students endpoint).
 */

import { api, unwrap } from '../client';

export type MsvStatus = 'none' | 'applied' | 'waitlisted' | 'approved' | 'rejected' | 'revoked';

export interface MsvEnrolmentRow {
  id: string;
  student_id: string;
  status: MsvStatus;
  created_at: string;
}

export interface MsvApplyInput {
  student_id: string;
  note?: string;
}

export const msvApi = {
  async apply(input: MsvApplyInput): Promise<MsvEnrolmentRow> {
    return unwrap<MsvEnrolmentRow>(api.post('/v1/msv/enrolments', input));
  },
};
