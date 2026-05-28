/**
 * Admin → Questions → AI review (`/admin/questions/ai-review`).
 *
 * Super_admin-only. Lists every AI-generated question with
 * `ai_review_status='pending_review'`. Each row has Approve / Reject
 * actions which call POST /api/admin/questions/review and refresh the
 * list. Approved questions immediately become available to quiz event
 * pickers; rejected stay in the table (read-only) so super_admin can
 * audit what the AI produced.
 */

import { listPendingAiQuestions, type QuestionRow } from '@/api/questions';
import { Card } from '@/components/ui/card';

import AiReviewActions from './ai-review-actions';

export default async function AiReviewPage() {
  let items: QuestionRow[] = [];
  let error: string | null = null;
  try {
    const res = await listPendingAiQuestions();
    items = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load questions';
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">AI-generated questions — review</h2>
        <p className="text-sm text-muted-foreground">
          Each item below was drafted by the AI service and must be approved before it can be added
          to a scheduled quiz event. Rejected questions are kept for the audit trail.
        </p>
      </header>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      {items.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No AI questions waiting for review.
        </Card>
      ) : null}

      <div className="space-y-4">
        {items.map((q) => (
          <Card key={q.id} className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center rounded-sm bg-saffron-50 px-2 py-0.5 font-semibold uppercase text-saffron-700">
                    {q.scope}
                  </span>
                  <span className="inline-flex items-center rounded-sm bg-warning-bg px-2 py-0.5 font-semibold uppercase text-warning">
                    Pending review
                  </span>
                  {q.topic ? (
                    <span className="text-xs text-muted-foreground">topic: {q.topic}</span>
                  ) : null}
                </div>
                <div className="font-display text-lg text-ink">{q.question_en}</div>
                <div className="text-sm text-muted-foreground">{q.question_hi}</div>
                <ul className="ml-4 list-disc space-y-1 text-sm">
                  {q.options.map((opt, ix) => {
                    const isCorrect = q.correct_indices.includes(ix);
                    return (
                      <li
                        key={opt.id}
                        className={isCorrect ? 'text-success font-semibold' : 'text-foreground'}
                      >
                        {opt.text_en}
                        {opt.text_hi ? (
                          <span className="ml-2 text-xs text-muted-foreground">{opt.text_hi}</span>
                        ) : null}
                        {isCorrect ? (
                          <span className="ml-2 inline-flex items-center rounded-sm bg-success-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase text-success">
                            Correct
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <AiReviewActions id={q.id} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
