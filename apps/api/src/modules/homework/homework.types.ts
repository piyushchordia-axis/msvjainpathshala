/**
 * Homework module — DTOs + service-result envelopes (SPEC §5.9, §6.12).
 */

import type { HomeworkAssignment, HomeworkSubmission } from '../../db/schema';

export interface CreateHomeworkInput {
  batch_id: string;
  title: string;
  description?: string | null;
  due_date: string; // YYYY-MM-DD
  attachment_asset_id?: string | null;
  /** When provided, only these students get the assignment; else the whole batch. */
  target_student_ids?: string[] | null;
  is_msv?: boolean;
}

export interface GradeHomeworkInput {
  status: 'approved' | 'starred';
  feedback_note?: string | null;
}

export interface AssignHomeworkResult {
  assignment: HomeworkAssignment;
  submissions_seeded: number;
}

export interface HomeworkForStudentRow {
  assignment: HomeworkAssignment;
  submission: HomeworkSubmission;
}

export interface GradeHomeworkResult {
  submission: HomeworkSubmission;
  punya_transaction_id: string;
  points_awarded: number;
}

export interface MarkDoneResult {
  submission: HomeworkSubmission;
}
