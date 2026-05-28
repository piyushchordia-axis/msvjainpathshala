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

export const studentsApi = {
  async myChildren(): Promise<{ items: StudentDto[] }> {
    return unwrap<{ items: StudentDto[] }>(api.get('/v1/parents/me/students'));
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
};
