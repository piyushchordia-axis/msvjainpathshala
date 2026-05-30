'use client';

/**
 * Compose a scheduled quiz event (SPEC §6.18). Picks a title, audience, start
 * time, duration, and a set of approved questions, then POSTs to
 * /api/admin/quiz-events. The backend requires at least one question.
 */

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { toast } from '@/components/ui/toast';

import type { QuizQuestionRow } from '@/api/admin-misc';

const AUDIENCES = [
  { value: 'all', label: 'Everyone in scope' },
  { value: 'msv_only', label: 'MSV students only' },
] as const;

export function CreateQuizForm({ questions }: { questions: QuizQuestionRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState<string>('all');
  const [startsAt, setStartsAt] = useState(''); // datetime-local value
  const [duration, setDuration] = useState('15');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const selectedCount = selected.size;
  const sortedQuestions = useMemo(() => questions, [questions]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 2) {
      toast.error('Add a title', 'Give the quiz a short title.');
      return;
    }
    if (!startsAt) {
      toast.error('Pick a start time');
      return;
    }
    const dur = Number(duration);
    if (!Number.isInteger(dur) || dur < 1 || dur > 600) {
      toast.error('Check the duration', 'Enter 1–600 minutes.');
      return;
    }
    if (selectedCount < 1) {
      toast.error('Select questions', 'Pick at least one question.');
      return;
    }
    // datetime-local has no timezone; convert to an ISO string with offset.
    const iso = new Date(startsAt).toISOString();

    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/quiz-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            audience_kind: audience,
            starts_at: iso,
            duration_minutes: dur,
            question_ids: Array.from(selected),
          }),
        });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) throw new Error(j?.error?.message ?? `Could not create (${res.status})`);
        toast.success('Quiz scheduled', title.trim());
        router.push('/admin/scheduled-quizzes');
        router.refresh();
      } catch (err) {
        toast.error('Could not create quiz', err instanceof Error ? err.message : 'Unknown error');
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-secondary" htmlFor="title">
            Title
          </label>
          <input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Paryushan knowledge quiz"
            maxLength={160}
            className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-secondary" htmlFor="audience">
            Audience
          </label>
          <select
            id="audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-cream-dark px-3 py-2 text-ink"
          >
            {AUDIENCES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-secondary" htmlFor="duration">
            Duration (minutes)
          </label>
          <input
            id="duration"
            type="number"
            min={1}
            max={600}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-secondary" htmlFor="startsAt">
            Starts at
          </label>
          <input
            id="startsAt"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-secondary">Questions</h3>
          <span className="text-xs text-muted-foreground">{selectedCount} selected</span>
        </div>
        {sortedQuestions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No approved questions yet. Approve questions in the question bank first.
          </p>
        ) : (
          <ul className="mt-2 max-h-96 space-y-2 overflow-y-auto rounded-md border border-border p-2">
            {sortedQuestions.map((q) => (
              <li key={q.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted/40">
                  <input
                    type="checkbox"
                    checked={selected.has(q.id)}
                    onChange={() => toggle(q.id)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm text-ink">{q.stem}</span>
                    <span className="text-xs uppercase text-muted-foreground">{q.language}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
        >
          {pending ? 'Scheduling…' : 'Schedule quiz'}
        </button>
      </div>
    </form>
  );
}
