/**
 * Admin → Exam detail (`/admin/exams/:id`).
 *
 * Shows the exam meta + a "Generate OTP" button (one-click reveal). Matches
 * the admin-forms.html visual style: bordered fields, saffron focus colour,
 * Mukta typography for content blocks.
 *
 * Server component for the read; client subcomponent for the actions
 * (Generate OTP, Release results) so the buttons can show inline state.
 */

import { notFound } from 'next/navigation';

import { listAdminExams, type ExamRow } from '@/api/exams';
import { Card } from '@/components/ui/card';

import ExamActions from './exam-actions';

export default async function ExamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let exam: ExamRow | null = null;
  let error: string | null = null;
  try {
    const list = await listAdminExams();
    exam = list.items.find((e) => e.id === id) ?? null;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load exam.';
  }
  if (!exam) return notFound();

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">{exam.title_en}</h2>
        <p className="text-sm text-muted-foreground">{exam.title_hi}</p>
      </header>
      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <Card className="space-y-4 p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Window opens" value={new Date(exam.window_start).toLocaleString()} />
          <Field label="Window closes" value={new Date(exam.window_end).toLocaleString()} />
          <Field label="Max attempts" value={exam.max_attempts.toString()} />
          <Field label="Total marks" value={exam.total_marks.toString()} />
          <Field label="Pass mark" value={exam.pass_mark.toString()} />
          <Field
            label="Punya rewards"
            value={`Completion +${exam.completion_points} · Top-3 +${exam.top_score_points}`}
          />
        </div>
      </Card>

      <Card className="space-y-4 p-6">
        <h3 className="font-display text-lg text-secondary">Exam OTP</h3>
        <p className="text-sm text-muted-foreground">
          Generate a class-wide 6-digit code, then read it aloud at the start of the exam window.
          The OTP is only valid for the first <strong>30 minutes</strong> after the window opens.
        </p>
        <ExamActions
          examId={exam.id}
          existingOtp={exam.exam_otp}
          windowStart={exam.window_start}
          resultsReleased={exam.results_released}
        />
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <div className="rounded-md border border-input bg-background px-3 py-2 text-sm text-ink">
        {value}
      </div>
    </div>
  );
}
