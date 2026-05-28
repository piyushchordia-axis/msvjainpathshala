/**
 * Shared types for the exams module (SPEC §5.14, §6.17, §8.9).
 */

import type {
  ExamAnswer,
  ExamAttempt,
  ExamQuestion,
  ExamQuestionOption,
  OnlineExam,
} from '../../db/schema';
import type { ExamQuestionType } from '@jp/shared';

export interface CreateExamQuestionInput {
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
}

export interface CreateExamInput {
  title_en: string;
  title_hi: string;
  description_en?: string | null;
  description_hi?: string | null;
  target_audience?: Record<string, unknown> | null;
  window_start: string; // ISO datetime
  window_end: string; // ISO datetime
  max_attempts?: number;
  pass_mark: number;
  completion_points?: number;
  top_score_points?: number;
  show_rank?: boolean;
  questions: CreateExamQuestionInput[];
}

export interface GenerateOtpResult {
  exam_id: string;
  exam_otp: string;
  /**
   * OTP only valid for the first 30 minutes of the exam window.
   * Computed = window_start + 30min.
   */
  otp_valid_until: string;
}

export interface StartAttemptInput {
  student_id: string;
  exam_otp: string;
}

export interface StartAttemptResult {
  attempt: ExamAttempt;
  questions: Array<{
    question: ExamQuestion;
    options: ExamQuestionOption[]; // is_correct REDACTED for the parent path
  }>;
  /** Server time when started — clients use this to drive the timer. */
  server_now: string;
}

export interface SaveAnswerInput {
  question_id: string;
  selected_option_ids?: string[];
  short_text_answer?: string;
}

export interface SubmitAttemptResult {
  attempt: ExamAttempt;
  auto_score: number;
  manual_pending: boolean;
}

export interface GradeAnswerInput {
  manual_score: number;
  admin_comment?: string;
}

export interface ReleaseResultsResult {
  exam: OnlineExam;
  ranks_emitted: number;
  punya_awards: number;
  pushes_enqueued: number;
}

/** SPEC §8.9 — OTP only valid for the first 30 minutes of the exam window. */
export const EXAM_OTP_WINDOW_MS = 30 * 60 * 1000;

export type { ExamAnswer, ExamAttempt, ExamQuestion, ExamQuestionOption, OnlineExam };
