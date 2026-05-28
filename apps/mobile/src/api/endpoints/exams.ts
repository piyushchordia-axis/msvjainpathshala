/**
 * Online exam endpoint wrappers used by the parent / student-view exam taking
 * screen (Step 19, SPEC §6.17 + §8.9).
 *
 * The MMKV-backed offline queue saves answers locally first; reconnect drains
 * via `saveAnswer()` in the order they were recorded.
 */

import { api, unwrap } from '../client';

export type ExamQuestionType =
  | 'mcq_single'
  | 'mcq_multi'
  | 'true_false'
  | 'short_text'
  | 'image_based';

export interface OnlineExamDto {
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
  completion_points: number;
  top_score_points: number;
  results_released: boolean;
  show_rank: boolean;
}

export interface ExamQuestionDto {
  id: string;
  exam_id: string;
  question_type: ExamQuestionType;
  question_en: string;
  question_hi: string;
  marks: number;
  order_index: number;
}

export interface ExamQuestionOptionDto {
  id: string;
  question_id: string;
  label_en: string;
  label_hi: string;
  /** Always false on the parent path (server-redacted). */
  is_correct: boolean;
  order_index: number;
}

export interface ExamAttemptDto {
  id: string;
  exam_id: string;
  student_id: string;
  started_at: string;
  submitted_at: string | null;
  status: 'in_progress' | 'submitted' | 'graded';
  score: number | null;
  auto_score: number | null;
  manual_score: number | null;
  otp_verified_at: string | null;
}

export interface StartAttemptResponse {
  attempt: ExamAttemptDto;
  questions: Array<{
    question: ExamQuestionDto;
    options: ExamQuestionOptionDto[];
  }>;
  server_now: string;
}

export interface SubmitAttemptResponse {
  attempt: ExamAttemptDto;
  auto_score: number;
  manual_pending: boolean;
}

export const examsApi = {
  async list(): Promise<{ items: OnlineExamDto[] }> {
    return unwrap<{ items: OnlineExamDto[] }>(api.get('/v1/exams'));
  },

  async start(
    examId: string,
    body: { student_id: string; exam_otp: string },
  ): Promise<StartAttemptResponse> {
    return unwrap<StartAttemptResponse>(api.post(`/v1/exams/${examId}/start`, body));
  },

  async saveAnswer(
    attemptId: string,
    body: { question_id: string; selected_option_ids?: string[]; short_text_answer?: string },
  ): Promise<{ answer: { id: string } }> {
    return unwrap<{ answer: { id: string } }>(
      api.post(`/v1/exam-attempts/${attemptId}/answer`, body),
    );
  },

  async submit(attemptId: string): Promise<SubmitAttemptResponse> {
    return unwrap<SubmitAttemptResponse>(api.post(`/v1/exam-attempts/${attemptId}/submit`, {}));
  },
};
