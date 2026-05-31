/**
 * Push-quiz endpoint wrappers — Step 20 (SPEC §6.18, §9.4).
 *
 * Two callers:
 *   - Parent / student-view → POST submit answer
 *   - Shikshak → POST create / start / next-question / end (the control screen)
 *
 * Real-time updates land via Socket.IO on `/push-quizzes/:quizId` (see
 * `src/realtime/push-quiz.ts`).
 */

import { api, unwrap } from '../client';

export interface PushQuizDto {
  id: string;
  batch_id: string;
  shikshak_user_id: string;
  started_at: string;
  expires_at: string;
  completion_points: number;
}

export interface PushQuizPublicQuestionDto {
  id: string;
  order_index: number;
  question_en: string;
  question_hi: string;
  expires_at: string;
  options: Array<{ id: string; text_en: string; text_hi: string }>;
}

export interface PushQuizLeaderboardEntryDto {
  student_id: string;
  full_name: string;
  score: number;
  rank: number;
  correct_count: number;
  total_count: number;
}

export const pushQuizzesApi = {
  // ---- Shikshak ------------------------------------------------------------

  async create(body: {
    batch_id: string;
    expires_in_seconds?: number;
    completion_points?: number;
    questions: Array<{
      question_en: string;
      question_hi: string;
      options: Array<{ id: string; text_en: string; text_hi: string }>;
      correct_indices: number[];
    }>;
  }): Promise<PushQuizDto> {
    return unwrap<PushQuizDto>(api.post('/v1/shikshak/push-quizzes', body));
  },

  async start(quizId: string): Promise<{
    quiz: PushQuizDto;
    total_questions: number;
    active_question: PushQuizPublicQuestionDto | null;
  }> {
    return unwrap(api.post(`/v1/quizzes/push/${quizId}/start`, {}));
  },

  async nextQuestion(quizId: string): Promise<{
    quiz: PushQuizDto;
    question: PushQuizPublicQuestionDto;
    question_number: number;
    total_questions: number;
  }> {
    return unwrap(api.post(`/v1/quizzes/push/${quizId}/next-question`, {}));
  },

  async end(quizId: string): Promise<{
    quiz: PushQuizDto;
    participants: number;
    punya_awards: number;
    leaderboard: PushQuizLeaderboardEntryDto[];
  }> {
    return unwrap(api.post(`/v1/quizzes/push/${quizId}/end`, {}));
  },

  async listForBatch(batchId: string): Promise<{ items: PushQuizDto[] }> {
    return unwrap(api.get(`/v1/shikshak/batches/${batchId}/push-quizzes`));
  },

  // ---- Parent / student-view ----------------------------------------------

  async submitAnswer(
    quizId: string,
    body: { student_id: string; question_id: string; selected_option_index: number },
  ): Promise<{ attempt: { id: string; score: number | null }; is_correct: boolean }> {
    return unwrap(api.post(`/v1/push-quizzes/${quizId}/submit`, body));
  },
};
