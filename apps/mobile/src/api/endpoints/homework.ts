/**
 * Homework endpoint wrappers used by the parent / student-view homework screens
 * (Step 18).
 */

import { api, unwrap } from '../client';

export type HomeworkStatus = 'pending' | 'starred' | 'approved' | 'late';

export interface HomeworkAssignmentDto {
  id: string;
  batch_id: string;
  title: string;
  description: string | null;
  due_date: string;
  attachment_asset_id: string | null;
  is_msv: boolean;
  target_student_ids: string[] | null;
}

export interface HomeworkSubmissionDto {
  id: string;
  assignment_id: string;
  student_id: string;
  status: HomeworkStatus;
  submission_asset_id: string | null;
  feedback_note: string | null;
  late: boolean;
  punya_transaction_id: string | null;
  marked_at: string | null;
}

export interface HomeworkForStudentRow {
  assignment: HomeworkAssignmentDto;
  submission: HomeworkSubmissionDto;
}

export const homeworkApi = {
  async listForStudent(studentId: string): Promise<{ items: HomeworkForStudentRow[] }> {
    return unwrap<{ items: HomeworkForStudentRow[] }>(
      api.get(`/v1/students/${studentId}/homework`),
    );
  },

  async markDone(
    assignmentId: string,
    body: { student_id: string; submission_asset_id?: string },
  ): Promise<{ submission: HomeworkSubmissionDto }> {
    return unwrap<{ submission: HomeworkSubmissionDto }>(
      api.post(`/v1/homework/${assignmentId}/mark-done`, body),
    );
  },
};
