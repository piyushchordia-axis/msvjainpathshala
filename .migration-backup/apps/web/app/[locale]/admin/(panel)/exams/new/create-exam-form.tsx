'use client';

/**
 * Create-exam form (city_admin+) with a dynamic question builder. Posts to
 * /api/admin/exams/create → POST /v1/admin/exams. Question types come from the
 * shared enum so they always match the backend.
 */

import { useState, useTransition } from 'react';

import { EXAM_QUESTION_TYPES } from '@jp/shared';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';

interface OptionDraft {
  en: string;
  hi: string;
  correct: boolean;
}
interface QuestionDraft {
  type: string;
  en: string;
  hi: string;
  marks: string;
  options: OptionDraft[];
}

const emptyQuestion = (): QuestionDraft => ({
  type: EXAM_QUESTION_TYPES[0] ?? 'single_choice',
  en: '',
  hi: '',
  marks: '1',
  options: [],
});

function localToIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export function CreateExamForm() {
  const [titleEn, setTitleEn] = useState('');
  const [titleHi, setTitleHi] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [passMark, setPassMark] = useState('0');
  const [maxAttempts, setMaxAttempts] = useState('1');
  const [questions, setQuestions] = useState<QuestionDraft[]>([emptyQuestion()]);
  const [pending, startTransition] = useTransition();

  function patchQuestion(i: number, patch: Partial<QuestionDraft>) {
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }
  function patchOption(qi: number, oi: number, patch: Partial<OptionDraft>) {
    setQuestions((qs) =>
      qs.map((q, idx) =>
        idx === qi
          ? { ...q, options: q.options.map((o, j) => (j === oi ? { ...o, ...patch } : o)) }
          : q,
      ),
    );
  }

  const startIso = localToIso(windowStart);
  const endIso = localToIso(windowEnd);
  const passNum = Number(passMark);
  const questionsValid = questions.every(
    (q) => q.en.trim().length >= 2 && q.hi.trim().length >= 2 && Number(q.marks) >= 1,
  );
  const valid =
    titleEn.trim().length >= 2 &&
    titleHi.trim().length >= 2 &&
    !!startIso &&
    !!endIso &&
    Number.isInteger(passNum) &&
    passNum >= 0 &&
    questions.length >= 1 &&
    questionsValid;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      toast.error(
        'Check the form',
        'Titles, a valid window, pass mark and complete questions are required.',
      );
      return;
    }
    const payload = {
      title_en: titleEn.trim(),
      title_hi: titleHi.trim(),
      window_start: startIso,
      window_end: endIso,
      pass_mark: passNum,
      ...(Number(maxAttempts) >= 1 ? { max_attempts: Number(maxAttempts) } : {}),
      questions: questions.map((q, i) => ({
        question_type: q.type,
        question_en: q.en.trim(),
        question_hi: q.hi.trim(),
        marks: Number(q.marks),
        order_index: i,
        ...(q.options.length
          ? {
              options: q.options.map((o, j) => ({
                label_en: o.en.trim(),
                label_hi: o.hi.trim(),
                is_correct: o.correct,
                order_index: j,
              })),
            }
          : {}),
      })),
    };
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/exams/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) throw new Error(j?.error?.message ?? `Could not create exam (${res.status})`);
        toast.success('Exam created', `${titleEn.trim()} is scheduled.`);
        setTitleEn('');
        setTitleHi('');
        setQuestions([emptyQuestion()]);
      } catch (err) {
        toast.error('Could not create exam', err instanceof Error ? err.message : 'Unknown error');
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
        <FieldEl label="Title (English)" value={titleEn} onChange={setTitleEn} />
        <FieldEl label="Title (Hindi)" value={titleHi} onChange={setTitleHi} />
        <FieldEl
          label="Window start"
          value={windowStart}
          onChange={setWindowStart}
          type="datetime-local"
        />
        <FieldEl
          label="Window end"
          value={windowEnd}
          onChange={setWindowEnd}
          type="datetime-local"
        />
        <FieldEl label="Pass mark" value={passMark} onChange={setPassMark} type="number" />
        <FieldEl
          label="Max attempts (1–5)"
          value={maxAttempts}
          onChange={setMaxAttempts}
          type="number"
        />
      </Card>

      {questions.map((q, qi) => (
        <Card key={qi} className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg text-secondary">Question {qi + 1}</h3>
            {questions.length > 1 ? (
              <button
                type="button"
                onClick={() => setQuestions((qs) => qs.filter((_, idx) => idx !== qi))}
                className="text-xs font-medium text-destructive hover:underline"
              >
                Remove
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Type</Label>
              <select
                value={q.type}
                onChange={(e) => patchQuestion(qi, { type: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm capitalize"
              >
                {EXAM_QUESTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <FieldEl
              label="Marks"
              value={q.marks}
              onChange={(v) => patchQuestion(qi, { marks: v })}
              type="number"
            />
            <FieldEl
              label="Question (English)"
              value={q.en}
              onChange={(v) => patchQuestion(qi, { en: v })}
            />
            <FieldEl
              label="Question (Hindi)"
              value={q.hi}
              onChange={(v) => patchQuestion(qi, { hi: v })}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-muted-foreground">
                Options (leave empty for short-text)
              </Label>
              <button
                type="button"
                onClick={() =>
                  patchQuestion(qi, { options: [...q.options, { en: '', hi: '', correct: false }] })
                }
                className="text-xs font-medium text-saffron hover:underline"
              >
                Add option
              </button>
            </div>
            {q.options.map((o, oi) => (
              <div key={oi} className="flex flex-wrap items-center gap-2">
                <Input
                  value={o.en}
                  onChange={(e) => patchOption(qi, oi, { en: e.target.value })}
                  placeholder="Option (EN)"
                  className="flex-1"
                />
                <Input
                  value={o.hi}
                  onChange={(e) => patchOption(qi, oi, { hi: e.target.value })}
                  placeholder="Option (HI)"
                  className="flex-1"
                />
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={o.correct}
                    onChange={(e) => patchOption(qi, oi, { correct: e.target.checked })}
                    className="h-4 w-4"
                  />
                  Correct
                </label>
                <button
                  type="button"
                  onClick={() =>
                    patchQuestion(qi, { options: q.options.filter((_, j) => j !== oi) })
                  }
                  className="text-xs text-destructive hover:underline"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </Card>
      ))}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setQuestions((qs) => [...qs, emptyQuestion()])}
          className="rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          Add question
        </button>
        <button
          type="submit"
          disabled={pending || !valid}
          className="rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create exam'}
        </button>
      </div>
    </form>
  );
}

function FieldEl({
  label,
  value,
  onChange,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <Label className="mb-1 block text-xs font-semibold text-muted-foreground">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} type={type} />
    </div>
  );
}
