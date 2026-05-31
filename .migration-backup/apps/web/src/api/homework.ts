/**
 * Homework admin API wrappers (web admin) — Step 18.
 * Mirrors apps/api/src/modules/homework/*.
 */

import { authenticatedServerClient } from './server-client';

export type HomeworkStatus = 'pending' | 'starred' | 'approved' | 'late';

export interface HomeworkAssignmentRow {
  id: string;
  batch_id: string;
  title: string;
  description: string | null;
  due_date: string;
  attachment_asset_id: string | null;
  is_msv: boolean;
  target_student_ids: string[] | null;
  created_at: string;
}

export interface HomeworkSubmissionRow {
  id: string;
  assignment_id: string;
  student_id: string;
  status: HomeworkStatus;
  submission_asset_id: string | null;
  feedback_note: string | null;
  late: boolean;
  marked_at: string | null;
  punya_transaction_id: string | null;
}

export async function listSubmissions(
  assignmentId: string,
): Promise<{ items: HomeworkSubmissionRow[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get(`/v1/admin/homework/${assignmentId}/submissions`);
  return res.data.data as { items: HomeworkSubmissionRow[] };
}

export async function gradeSubmission(
  assignmentId: string,
  studentId: string,
  input: { status: 'approved' | 'starred'; feedback_note?: string },
): Promise<{
  submission: HomeworkSubmissionRow;
  punya_transaction_id: string;
  points_awarded: number;
}> {
  const client = await authenticatedServerClient();
  const res = await client.post(
    `/v1/admin/homework/${assignmentId}/submissions/${studentId}/grade`,
    input,
  );
  return res.data.data;
}

export async function createAssignment(input: {
  batch_id: string;
  title: string;
  description?: string;
  due_date: string;
  target_student_ids?: string[];
}): Promise<{ assignment: HomeworkAssignmentRow; submissions_seeded: number }> {
  const client = await authenticatedServerClient();
  const res = await client.post('/v1/admin/homework', input);
  return res.data.data;
}
