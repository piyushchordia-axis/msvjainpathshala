/**
 * Admin → New scheduled quiz (`/admin/scheduled-quizzes/new`, SPEC §6.18).
 * Server-loads the approved question bank, then renders the composer form.
 */

import { listAdminQuestions, type QuizQuestionRow } from '@/api/admin-misc';
import { Card } from '@/components/ui/card';

import { CreateQuizForm } from './create-quiz-form';

export default async function NewScheduledQuizPage() {
  let questions: QuizQuestionRow[] = [];
  let error: string | null = null;
  try {
    const res = await listAdminQuestions();
    questions = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load the question bank.';
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">New scheduled quiz</h2>
        <p className="text-sm text-muted-foreground">
          Pick the audience, schedule, and questions for a timed quiz event.
        </p>
      </header>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : (
        <Card className="p-6">
          <CreateQuizForm questions={questions} />
        </Card>
      )}
    </div>
  );
}
