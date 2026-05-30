/**
 * Students + enrolments endpoint wrappers used by the parent screens.
 */

import { api, unwrap } from '../client';

export interface StudentDto {
  id: string;
  parent_user_id: string;
  full_name: string;
  father_name: string | null;
  dob: string;
  age_group: 'bal' | 'kishor' | 'tarun' | 'yuva';
  centre_id: string;
  batch_id: string | null;
  student_code: string;
  msv_status: 'none' | 'applied' | 'waitlisted' | 'approved' | 'rejected' | 'revoked';
  status: 'active' | 'inactive';
  enrolled_at: string;
  deactivated_at: string | null;
}

export interface EnrolmentSubmitInput {
  parent_phone?: string;
  parent_full_name?: string;
  preferred_language?: 'en' | 'hi';
  requested_centre_id: string;
  requested_batch_id: string;
  full_name: string;
  dob: string;
  age_group: 'bal' | 'kishor' | 'tarun' | 'yuva';
  father_name?: string;
  form_data?: Record<string, unknown>;
}

/** Loose admin/teacher roster row (defensive optional fields). */
export interface AdminStudentRow {
  id: string;
  full_name: string;
  student_code?: string;
  age_group?: string;
  status?: string;
}

/** Loose pending-enrolment row for the sanchalak approval queue. */
export interface PendingEnrolmentRow {
  id: string;
  full_name?: string;
  student_name?: string;
  requested_centre_name?: string;
  centre_name?: string;
  requested_batch_name?: string;
  batch_name?: string;
  dob?: string;
  status?: string;
}

export const studentsApi = {
  async myChildren(): Promise<{ items: StudentDto[] }> {
    return unwrap<{ items: StudentDto[] }>(api.get('/v1/parents/me/students'));
  },

  /** Roster for shikshak+ (scope-filtered server-side). */
  async listForAdmin(
    params: { status?: 'active' | 'inactive'; limit?: number } = {},
  ): Promise<{ items: AdminStudentRow[] }> {
    return unwrap<{ items: AdminStudentRow[] }>(api.get('/v1/students', { params }));
  },
};

export const enrolmentsApi = {
  async submit(input: EnrolmentSubmitInput): Promise<{
    enrolment: {
      id: string;
      status: 'pending' | 'approved' | 'rejected' | 'waitlisted';
    };
  }> {
    return unwrap(api.post('/v1/enrolments', input));
  },

  /** Pending enrolment applications in the actor's scope (sanchalak+). */
  async listPending(): Promise<{ items: PendingEnrolmentRow[] }> {
    return unwrap<{ items: PendingEnrolmentRow[] }>(
      api.get('/v1/enrolments', { params: { status: 'pending' } }),
    );
  },

  async approve(id: string): Promise<unknown> {
    return unwrap<unknown>(api.post(`/v1/enrolments/${id}/approve`, {}));
  },

  async reject(id: string, reason: string): Promise<unknown> {
    return unwrap<unknown>(api.post(`/v1/enrolments/${id}/reject`, { reason }));
  },
};
