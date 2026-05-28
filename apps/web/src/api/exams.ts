/**
 * Exams admin API wrappers (web admin) — Step 19.
 */

import { authenticatedServerClient } from './server-client';

export type ExamQuestionType =
  | 'mcq_single'
  | 'mcq_multi'
  | 'true_false'
  | 'short_text'
  | 'image_based';

export interface ExamRow {
  id: string;
  city_id: string;
  title_en: string;
  title_hi: string;
  description_en: string | null;
  description_hi: string | null;
  window_start: string;
  window_end: string;
  max_attempts: number;
  total_marks: number;
  pass_mark: number;
  exam_otp: string | null;
  completion_points: number;
  top_score_points: number;
  results_released: boolean;
  show_rank: boolean;
}

export interface CreateExamInput {
  title_en: string;
  title_hi: string;
  description_en?: string;
  description_hi?: string;
  window_start: string;
  window_end: string;
  max_attempts?: number;
  pass_mark: number;
  completion_points?: number;
  top_score_points?: number;
  show_rank?: boolean;
  questions: Array<{
    question_type: ExamQuestionType;
    question_en: string;
    question_hi: string;
    marks: number;
    order_index: number;
    options?: Array<{
      label_en: string;
      label_hi: string;
      is_correct: boolean;
      order_index: number;
    }>;
  }>;
}

export async function listAdminExams(): Promise<{ items: ExamRow[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/exams');
  return res.data.data as { items: ExamRow[] };
}

export async function createExam(
  input: CreateExamInput,
): Promise<{ exam: ExamRow; questions: number; options: number }> {
  const client = await authenticatedServerClient();
  const res = await client.post('/v1/admin/exams', input);
  return res.data.data;
}

export async function generateExamOtp(
  examId: string,
): Promise<{ exam_id: string; exam_otp: string; otp_valid_until: string }> {
  const client = await authenticatedServerClient();
  const res = await client.post(`/v1/admin/exams/${examId}/otp`, {});
  return res.data.data;
}

export async function releaseExamResults(examId: string): Promise<{
  ranks_emitted: number;
  punya_awards: number;
  pushes_enqueued: number;
}> {
  const client = await authenticatedServerClient();
  const res = await client.post(`/v1/admin/exams/${examId}/release-results`, {});
  return res.data.data;
}
