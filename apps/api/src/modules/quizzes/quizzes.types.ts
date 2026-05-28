/**
 * Shared types for the quizzes module (SPEC §5.14, §6.18) — Step 20.
 *
 * Three sub-domains:
 *   1. `QuestionsService` — the reusable bank.
 *   2. `QuizEventsService` — scheduled time-windowed quizzes.
 *   3. `PushQuizzesService` — live in-class quizzes via Socket.IO.
 */

import type {
  AiGenerationJob,
  PushQuiz,
  PushQuizAttempt,
  PushQuizQuestion,
  Question,
  QuizAttempt,
  QuizEvent,
  QuizEventQuestion,
} from '../../db/schema';
import type { AgeGroup, Language, QuizScope } from '@jp/shared';

// ---------------------------------------------------------------------------
// Question bank
// ---------------------------------------------------------------------------

export interface QuestionOption {
  id: string;
  text_en: string;
  text_hi: string;
}

export interface CreateQuestionInput {
  scope: QuizScope;
  city_id?: string | null;
  question_en: string;
  question_hi: string;
  options: QuestionOption[];
  correct_indices: number[];
  difficulty?: string | null;
  age_groups?: AgeGroup[] | null;
  topic?: string | null;
}

export interface ReviewAiQuestionInput {
  decision: 'approve' | 'reject';
}

// ---------------------------------------------------------------------------
// Scheduled quiz events
// ---------------------------------------------------------------------------

export interface CreateQuizEventInput {
  title_en: string;
  title_hi: string;
  scope: QuizScope;
  city_id?: string | null;
  centre_id?: string | null;
  batch_id?: string | null;
  start_at: string;
  end_at: string;
  participation_points?: number;
  win_points?: number;
  target_age_groups?: AgeGroup[] | null;
  /** Ordered question ids drawn from the bank. */
  question_ids: string[];
}

export interface QuizEventDto {
  event: QuizEvent;
  questions: Array<{ link: QuizEventQuestion; question: Question }>;
}

export interface StartQuizAttemptInput {
  student_id: string;
}

export interface StartQuizAttemptResult {
  attempt: QuizAttempt;
  questions: Array<{
    id: string;
    question_en: string;
    question_hi: string;
    options: QuestionOption[];
    /** Server intentionally omits `correct_indices` here. */
  }>;
  server_now: string;
}

export interface SubmitQuizAttemptInput {
  answers: Array<{
    question_id: string;
    selected_indices: number[];
  }>;
}

export interface SubmitQuizAttemptResult {
  attempt: QuizAttempt;
  score: number;
  correct_count: number;
  total_count: number;
}

// ---------------------------------------------------------------------------
// Push (live) quizzes
// ---------------------------------------------------------------------------

export interface CreatePushQuizInput {
  batch_id: string;
  /** TTL in seconds after the last question is shown — defaults to 5 min. */
  expires_in_seconds?: number;
  completion_points?: number;
  questions: Array<{
    question_en: string;
    question_hi: string;
    options: QuestionOption[];
    correct_indices: number[];
  }>;
}

export interface StartPushQuizResult {
  quiz: PushQuiz;
  total_questions: number;
  /** Currently-active question — null until shikshak calls next-question. */
  active_question: PushQuizPublicQuestion | null;
}

export interface PushQuizPublicQuestion {
  id: string;
  order_index: number;
  question_en: string;
  question_hi: string;
  /** Active deadline in ms-from-server-now (set by the per-question timer). */
  expires_at: string;
  options: QuestionOption[];
}

export interface NextQuestionResult {
  quiz: PushQuiz;
  question: PushQuizPublicQuestion;
  question_number: number;
  total_questions: number;
}

export interface SubmitPushAnswerInput {
  question_id: string;
  selected_option_index: number;
}

export interface SubmitPushAnswerResult {
  attempt: PushQuizAttempt;
  is_correct: boolean;
}

export interface EndPushQuizResult {
  quiz: PushQuiz;
  participants: number;
  punya_awards: number;
  leaderboard: PushQuizLeaderboardEntry[];
}

export interface PushQuizLeaderboardEntry {
  student_id: string;
  full_name: string;
  score: number;
  rank: number;
  correct_count: number;
  total_count: number;
}

// ---------------------------------------------------------------------------
// AI quiz generation
// ---------------------------------------------------------------------------

export interface AiGenerateInput {
  topic: string;
  age_group?: AgeGroup | null;
  language: Language;
  count: number;
}

export interface AiGenerateResult {
  job: AiGenerationJob;
}

// ---------------------------------------------------------------------------
// Socket.IO event payloads (typed for the gateway emit calls)
// ---------------------------------------------------------------------------

export interface QuizStartedPayload {
  quiz_id: string;
  batch_id: string;
  total_questions: number;
  started_at: string;
  expires_at: string;
}

export interface QuizQuestionNextPayload {
  quiz_id: string;
  question: PushQuizPublicQuestion;
  question_number: number;
  total_questions: number;
}

export interface QuizAnswerReceivedPayload {
  quiz_id: string;
  question_id: string;
  /** Aggregate per option: how many students picked each option. */
  counts: number[];
  total_participants: number;
}

export interface QuizEndedPayload {
  quiz_id: string;
  participants: number;
  leaderboard: PushQuizLeaderboardEntry[];
  ended_at: string;
}

/** Per-question timer window. Default 30s — overridable per question later. */
export const PUSH_QUIZ_QUESTION_WINDOW_MS = 30 * 1000;

/** Push quiz defaults. */
export const PUSH_QUIZ_DEFAULT_EXPIRES_SECONDS = 300;
export const PUSH_QUIZ_DEFAULT_COMPLETION_POINTS = 10;

export type {
  AiGenerationJob,
  PushQuiz,
  PushQuizAttempt,
  PushQuizQuestion,
  Question,
  QuizAttempt,
  QuizEvent,
  QuizEventQuestion,
};
