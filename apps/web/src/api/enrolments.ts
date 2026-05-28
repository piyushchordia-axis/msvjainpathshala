/**
 * Enrolments API wrappers used by the admin pages.
 * Server-side fetches — they read the access cookie automatically via
 * `authenticatedServerClient`.
 */

import { authenticatedServerClient } from './server-client';

export type EnrolmentStatus = 'pending' | 'approved' | 'rejected' | 'waitlisted';

export interface AdminEnrolment {
  id: string;
  student_id: string | null;
  parent_user_id: string;
  requested_centre_id: string;
  requested_batch_id: string;
  status: EnrolmentStatus;
  reviewer_user_id: string | null;
  decided_at: string | null;
  rejection_reason: string | null;
  form_response_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function listEnrolments(filters: {
  status?: EnrolmentStatus;
  centre_id?: string;
  batch_id?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: AdminEnrolment[] }> {
  const client = await authenticatedServerClient();
  const params: Record<string, string | number> = {};
  if (filters.status) params.status = filters.status;
  if (filters.centre_id) params.centre_id = filters.centre_id;
  if (filters.batch_id) params.batch_id = filters.batch_id;
  if (filters.search) params.search = filters.search;
  if (filters.limit) params.limit = filters.limit;
  if (filters.offset) params.offset = filters.offset;
  const res = await client.get('/v1/enrolments', { params });
  return res.data.data as { items: AdminEnrolment[] };
}

export async function getEnrolment(id: string): Promise<AdminEnrolment> {
  const client = await authenticatedServerClient();
  const res = await client.get(`/v1/enrolments/${id}`);
  return res.data.data as AdminEnrolment;
}

export async function getFormResponse(
  responseId: string,
): Promise<{ responses: Record<string, unknown> } | null> {
  // Form responses endpoint lands in a later step; for Step 10 we surface
  // a stub. The Enrolment detail page degrades gracefully when this returns null.
  void responseId;
  return null;
}
