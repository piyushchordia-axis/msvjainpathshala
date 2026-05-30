/**
 * Admin → Scheduled quizzes (`/admin/scheduled-quizzes`, SPEC §6.18).
 *
 * Lists quiz events visible to the actor (GET /v1/quiz-events) with their
 * status, start time, duration, and question count. Scheduled events can be
 * started early via the row action.
 */

import { listQuizEvents, type QuizEventRow } from '@/api/admin-misc';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

import { StartQuizButton } from './start-button';

const STATUS_CLASS: Record<string, string> = {
  scheduled: 'bg-amber-500/10 text-amber-700',
  live: 'bg-emerald-500/10 text-emerald-700',
  ended: 'bg-muted text-muted-foreground',
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

export default async function ScheduledQuizzesPage() {
  let items: QuizEventRow[] = [];
  let error: string | null = null;
  try {
    const res = await listQuizEvents();
    items = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load quizzes.';
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">Scheduled quizzes</h2>
          <p className="text-sm text-muted-foreground">
            Timed quiz events for your audience. Start a scheduled quiz early if needed.
          </p>
        </div>
        <Link
          href="/admin/scheduled-quizzes/new"
          className="rounded-md bg-saffron px-3 py-2 text-sm font-semibold text-white hover:bg-saffron-700"
        >
          New quiz
        </Link>
      </header>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Starts</th>
                <th className="px-4 py-3 text-right">Duration</th>
                <th className="px-4 py-3 text-right">Questions</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    No quizzes scheduled yet.
                  </td>
                </tr>
              ) : (
                items.map((q) => (
                  <tr key={q.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{q.title}</td>
                    <td className="px-4 py-3 text-xs">{fmtWhen(q.starts_at)}</td>
                    <td className="px-4 py-3 text-right text-xs">{q.duration_minutes} min</td>
                    <td className="px-4 py-3 text-right text-xs">
                      {Array.isArray(q.question_ids) ? q.question_ids.length : 0}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${
                          STATUS_CLASS[q.status] ?? 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {q.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StartQuizButton id={q.id} status={q.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
