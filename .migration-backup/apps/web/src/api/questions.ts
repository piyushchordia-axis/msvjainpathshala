/**
 * Admin web API wrappers for the Quiz question bank — Step 20.
 *
 * Used by the AI review page (super_admin only) and by the quiz event picker
 * UI to surface approved questions.
 */

import { authenticatedServerClient } from './server-client';

export type AiReviewStatus = 'pending_review' | 'approved' | 'rejected';

export interface QuestionRow {
  id: string;
  scope: 'national' | 'state' | 'city' | 'centre' | 'batch';
  city_id: string | null;
  question_en: string;
  question_hi: string;
  options: Array<{ id: string; text_en: string; text_hi: string }>;
  correct_indices: number[];
  difficulty: string | null;
  topic: string | null;
  source: 'manual' | 'ai';
  is_ai_generated: boolean;
  ai_review_status: AiReviewStatus | null;
  created_at: string;
  updated_at: string;
}

export async function listPendingAiQuestions(): Promise<{ items: QuestionRow[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/admin/questions/pending-ai-review');
  return res.data.data as { items: QuestionRow[] };
}

export async function reviewAiQuestion(
  id: string,
  decision: 'approve' | 'reject',
): Promise<QuestionRow> {
  const client = await authenticatedServerClient();
  const res = await client.post(`/v1/admin/questions/${id}/review`, { decision });
  return res.data.data as QuestionRow;
}
