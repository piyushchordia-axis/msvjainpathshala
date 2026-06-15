/**
 * Student exam take-flow (public area, student-only).
 *
 * Flow mirrors the /v1/exams student API:
 *   list (GET /v1/exams/available)
 *     → start (POST /v1/exams/:id/start, optional OTP)
 *     → answer (MCQ single/multi + free text)
 *     → submit (POST /v1/exams/attempts/:attemptId/submit)
 *     → result (GET /v1/exams/attempts/:attemptId/result — gated on release).
 *
 * Auth + role are enforced server-side (requireAuth + role student); we use the
 * cookie session client (apiGet/apiPost) which carries credentials and refreshes
 * expired access tokens transparently.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Clock, FileQuestion, KeyRound, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useLocale } from '@/lib/locale-context';
import { toast } from '@/components/ui/toast-jp';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

/* ----------------------------------------------------------------- types --- */

interface AvailableExam {
  id: string;
  title_en: string;
  title_hi: string | null;
  window_start: string;
  window_end: string;
  total_marks: number;
  pass_mark: number;
  max_attempts: number;
  requires_otp: boolean;
  already_attempted_count: number;
}

interface StartOption {
  id: string;
  option_en: string;
  option_hi: string | null;
}

interface StartQuestion {
  id: string;
  question_en: string;
  question_hi: string | null;
  question_type: 'single_choice' | 'multi_choice' | 'text';
  marks: number;
  options: StartOption[];
}

interface StartResponse {
  attempt_id: string;
  questions: StartQuestion[];
}

interface SubmitResponse {
  attempt_id: string;
  status: string;
  auto_score: number;
  needs_grading: boolean;
  score: number | null;
}

interface ResultResponse {
  status: string;
  needs_grading?: boolean;
  score?: number;
  total_marks?: number;
  pass_mark?: number;
  passed?: boolean;
  per_question?: { question_id: string; marks_awarded: number | null; is_correct: boolean | null }[];
}

/* ----------------------------------------------------- local answer state --- */

type Phase =
  | { kind: 'list' }
  | { kind: 'otp'; exam: AvailableExam }
  | { kind: 'taking'; exam: AvailableExam; attemptId: string; questions: StartQuestion[] }
  | { kind: 'result'; exam: AvailableExam; attemptId: string; submit: SubmitResponse };

/** questionId -> { selected option ids } | { text } */
interface AnswerState {
  selected: Record<string, string[]>;
  text: Record<string, string>;
}

function fmtRange(start: string, end: string, hi: boolean): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  const loc = hi ? 'hi-IN' : 'en-IN';
  try {
    return `${new Date(start).toLocaleString(loc, opts)} – ${new Date(end).toLocaleString(loc, opts)}`;
  } catch {
    return `${start} – ${end}`;
  }
}

/* ------------------------------------------------------------- list view --- */

function ExamList({ onStart }: { onStart: (exam: AvailableExam) => void }) {
  const hi = useLocale() === 'hi';
  const [items, setItems] = useState<AvailableExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiGet<{ items: AvailableExam[] }>('/v1/exams/available')
      .then((r) => setItems(r?.items ?? []))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : hi ? 'परीक्षाएँ लोड नहीं हुईं।' : 'Could not load exams.'),
      )
      .finally(() => setLoading(false));
  }, [hi]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <div className="mt-10 text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</div>;
  }
  if (error) {
    return (
      <Card className="mt-10 p-6">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={load}>
          {hi ? 'पुनः प्रयास करें' : 'Try again'}
        </Button>
      </Card>
    );
  }
  if (items.length === 0) {
    return (
      <Card className="mt-10 p-6 text-muted-foreground">
        {hi ? 'अभी कोई परीक्षा उपलब्ध नहीं है।' : 'No exams available right now.'}
      </Card>
    );
  }

  const now = Date.now();
  return (
    <div className="mt-10 grid gap-4 sm:grid-cols-2">
      {items.map((ex) => {
        const title = (hi ? ex.title_hi : ex.title_en) ?? ex.title_en;
        const open = now >= new Date(ex.window_start).getTime() && now <= new Date(ex.window_end).getTime();
        const upcoming = now < new Date(ex.window_start).getTime();
        const attemptsLeft = ex.max_attempts - ex.already_attempted_count;
        const exhausted = attemptsLeft <= 0;
        return (
          <Card key={ex.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-display text-lg text-secondary">{title}</h2>
              {upcoming ? (
                <Badge variant="secondary">{hi ? 'आगामी' : 'Upcoming'}</Badge>
              ) : open ? (
                <Badge>{hi ? 'खुला' : 'Open'}</Badge>
              ) : (
                <Badge variant="outline">{hi ? 'बंद' : 'Closed'}</Badge>
              )}
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {fmtRange(ex.window_start, ex.window_end, hi)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded bg-muted px-2 py-0.5">
                {ex.total_marks} {hi ? 'अंक' : 'marks'}
              </span>
              <span className="rounded bg-muted px-2 py-0.5">
                {hi ? 'उत्तीर्णांक' : 'Pass'} {ex.pass_mark}
              </span>
              <span className="rounded bg-muted px-2 py-0.5">
                {hi ? 'शेष प्रयास' : 'Attempts left'} {Math.max(0, attemptsLeft)}/{ex.max_attempts}
              </span>
              {ex.requires_otp ? (
                <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5">
                  <KeyRound className="h-3 w-3" />
                  {hi ? 'एक्सेस कोड' : 'Access code'}
                </span>
              ) : null}
            </div>
            <div className="mt-4 flex-1" />
            <Button
              className="mt-4 w-fit"
              size="sm"
              disabled={!open || exhausted}
              onClick={() => onStart(ex)}
            >
              {exhausted
                ? hi
                  ? 'सभी प्रयास समाप्त'
                  : 'No attempts left'
                : !open
                  ? upcoming
                    ? hi
                      ? 'अभी शुरू नहीं'
                      : 'Not open yet'
                    : hi
                      ? 'परीक्षा बंद'
                      : 'Window closed'
                  : hi
                    ? 'परीक्षा शुरू करें'
                    : 'Start exam'}
            </Button>
          </Card>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- otp gate --- */

function OtpGate({
  exam,
  onStarted,
  onCancel,
}: {
  exam: AvailableExam;
  onStarted: (r: StartResponse) => void;
  onCancel: () => void;
}) {
  const hi = useLocale() === 'hi';
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);

  async function begin(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiPost<StartResponse>(`/v1/exams/${exam.id}/start`, exam.requires_otp ? { otp: otp.trim() } : {});
      onStarted(res);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'ERR_OTP_INVALID') {
        toast.error(hi ? 'गलत एक्सेस कोड।' : 'Invalid access code.');
      } else if (code === 'ERR_MAX_ATTEMPTS') {
        toast.error(hi ? 'आपके सभी प्रयास समाप्त हो गए हैं।' : 'You have used all your attempts.');
      } else if (code === 'ERR_WINDOW_CLOSED') {
        toast.error(hi ? 'परीक्षा का समय खुला नहीं है।' : 'The exam window is not open.');
      } else {
        toast.error(
          hi ? 'परीक्षा शुरू नहीं हो सकी।' : 'Could not start the exam.',
          err instanceof ApiError ? err.message : undefined,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const title = (hi ? exam.title_hi : exam.title_en) ?? exam.title_en;
  return (
    <Card className="mx-auto mt-10 max-w-md p-6">
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {hi ? 'सभी परीक्षाएँ' : 'All exams'}
      </button>
      <h2 className="mt-4 font-display text-xl text-secondary">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {exam.requires_otp
          ? hi
            ? 'इस परीक्षा के लिए एक्सेस कोड आवश्यक है। प्रारंभ करने के लिए कोड दर्ज करें।'
            : 'This exam needs an access code. Enter it to begin.'
          : hi
            ? 'परीक्षा शुरू करने के लिए नीचे क्लिक करें।'
            : 'Click below to begin the exam.'}
      </p>
      <form className="mt-5 space-y-4" onSubmit={begin}>
        {exam.requires_otp ? (
          <Input
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            placeholder={hi ? 'एक्सेस कोड' : 'Access code'}
            autoFocus
            required
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {hi ? 'रद्द करें' : 'Cancel'}
          </Button>
          <Button type="submit" disabled={busy || (exam.requires_otp && !otp.trim())}>
            {busy ? (hi ? 'शुरू हो रहा है…' : 'Starting…') : hi ? 'परीक्षा शुरू करें' : 'Start exam'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------ taking view --- */

function Taking({
  exam,
  attemptId,
  questions,
  onSubmitted,
  onCancel,
}: {
  exam: AvailableExam;
  attemptId: string;
  questions: StartQuestion[];
  onSubmitted: (r: SubmitResponse) => void;
  onCancel: () => void;
}) {
  const hi = useLocale() === 'hi';
  const [answers, setAnswers] = useState<AnswerState>({ selected: {}, text: {} });
  const [busy, setBusy] = useState(false);

  function pickSingle(qid: string, optionId: string) {
    setAnswers((p) => ({ ...p, selected: { ...p.selected, [qid]: [optionId] } }));
  }
  function toggleMulti(qid: string, optionId: string) {
    setAnswers((p) => {
      const cur = p.selected[qid] ?? [];
      const next = cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId];
      return { ...p, selected: { ...p.selected, [qid]: next } };
    });
  }
  function setText(qid: string, value: string) {
    setAnswers((p) => ({ ...p, text: { ...p.text, [qid]: value } }));
  }

  const answeredCount = questions.filter((q) => {
    if (q.question_type === 'text') return (answers.text[q.id] ?? '').trim().length > 0;
    return (answers.selected[q.id] ?? []).length > 0;
  }).length;

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      const payload = {
        answers: questions.map((q) => {
          if (q.question_type === 'text') {
            return { question_id: q.id, text_answer: answers.text[q.id] ?? '' };
          }
          return { question_id: q.id, selected_option_ids: answers.selected[q.id] ?? [] };
        }),
      };
      const res = await apiPost<SubmitResponse>(`/v1/exams/attempts/${attemptId}/submit`, payload);
      onSubmitted(res);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'ERR_ALREADY_SUBMITTED') {
        toast.error(hi ? 'यह प्रयास पहले ही जमा हो चुका है।' : 'This attempt was already submitted.');
      } else {
        toast.error(
          hi ? 'उत्तर जमा नहीं हुए।' : 'Could not submit answers.',
          err instanceof ApiError ? err.message : undefined,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const title = (hi ? exam.title_hi : exam.title_en) ?? exam.title_en;
  return (
    <div className="mt-8 space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="font-display text-lg text-secondary">{title}</h2>
          <p className="text-sm text-muted-foreground">
            {answeredCount}/{questions.length} {hi ? 'उत्तर दिए' : 'answered'}
          </p>
        </div>
        <Badge variant="outline">
          {exam.total_marks} {hi ? 'अंक' : 'marks'}
        </Badge>
      </Card>

      {questions.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          {hi ? 'इस परीक्षा में कोई प्रश्न नहीं है।' : 'This exam has no questions.'}
        </Card>
      ) : (
        questions.map((q, i) => {
          const prompt = (hi ? q.question_hi : q.question_en) ?? q.question_en;
          const selected = answers.selected[q.id] ?? [];
          return (
            <Card key={q.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium">
                  {i + 1}. {prompt}
                </p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {q.marks} {q.marks === 1 ? (hi ? 'अंक' : 'mark') : hi ? 'अंक' : 'marks'}
                </span>
              </div>

              {q.question_type === 'text' ? (
                <Textarea
                  className="mt-3"
                  rows={4}
                  value={answers.text[q.id] ?? ''}
                  onChange={(e) => setText(q.id, e.target.value)}
                  placeholder={hi ? 'अपना उत्तर लिखें…' : 'Write your answer…'}
                />
              ) : (
                <div className="mt-3 space-y-2">
                  {q.options.map((o) => {
                    const on = selected.includes(o.id);
                    const label = (hi ? o.option_hi : o.option_en) ?? o.option_en;
                    const multi = q.question_type === 'multi_choice';
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => (multi ? toggleMulti(q.id, o.id) : pickSingle(q.id, o.id))}
                        className={`flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${
                          on
                            ? 'border-primary bg-primary/5 text-foreground'
                            : 'border-input bg-background text-foreground hover:bg-muted'
                        }`}
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center border text-[10px] ${
                            multi ? 'rounded' : 'rounded-full'
                          } ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-input text-transparent'}`}
                        >
                          <CheckCircle2 className="h-3 w-3" />
                        </span>
                        {label}
                      </button>
                    );
                  })}
                  {q.question_type === 'multi_choice' ? (
                    <p className="text-xs text-muted-foreground">
                      {hi ? 'एक या अधिक विकल्प चुनें।' : 'Select one or more options.'}
                    </p>
                  ) : null}
                </div>
              )}
            </Card>
          );
        })
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          {hi ? 'छोड़ें' : 'Leave'}
        </Button>
        <Button onClick={submit} disabled={busy || questions.length === 0}>
          {busy ? (hi ? 'जमा हो रहा है…' : 'Submitting…') : hi ? 'परीक्षा जमा करें' : 'Submit exam'}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ result view --- */

function Result({
  exam,
  attemptId,
  submit,
  onDone,
}: {
  exam: AvailableExam;
  attemptId: string;
  submit: SubmitResponse;
  onDone: () => void;
}) {
  const hi = useLocale() === 'hi';
  const [result, setResult] = useState<ResultResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<ResultResponse>(`/v1/exams/attempts/${attemptId}/result`)
      .then((r) => setResult(r ?? null))
      .catch(() => setResult(null))
      .finally(() => setLoading(false));
  }, [attemptId]);

  const title = (hi ? exam.title_hi : exam.title_en) ?? exam.title_en;
  const released = !!result && typeof result.score === 'number';

  return (
    <Card className="mx-auto mt-10 max-w-lg p-6">
      <h2 className="font-display text-xl text-secondary">{title}</h2>

      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</p>
      ) : !released ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-medium text-foreground">
            {hi ? 'आपका उत्तर जमा हो गया है।' : 'Your answers have been submitted.'}
          </p>
          <p className="text-sm text-muted-foreground">
            {submit.needs_grading
              ? hi
                ? 'इसमें मूल्यांकन हेतु प्रश्न हैं। परिणाम जारी होने पर उपलब्ध होगा।'
                : 'This exam has questions awaiting grading. Your result will appear once released.'
              : hi
                ? 'परिणाम जारी होने पर यहाँ दिखाई देगा।'
                : 'Your result will appear here once it is released.'}
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between rounded-lg bg-muted p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{hi ? 'अंक' : 'Score'}</p>
              <p className="mt-1 font-display text-3xl text-secondary">
                {result.score}
                <span className="text-base text-muted-foreground"> / {result.total_marks}</span>
              </p>
            </div>
            {result.passed ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                {hi ? 'उत्तीर्ण' : 'Passed'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 text-sm font-medium text-destructive">
                <XCircle className="h-4 w-4" />
                {hi ? 'अनुत्तीर्ण' : 'Not passed'}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {hi ? 'उत्तीर्णांक' : 'Pass mark'}: {result.pass_mark}
          </p>
        </div>
      )}

      <Button variant="outline" className="mt-6" onClick={onDone}>
        <ArrowLeft className="mr-1 h-4 w-4" />
        {hi ? 'सभी परीक्षाओं पर वापस' : 'Back to exams'}
      </Button>
    </Card>
  );
}

/* ---------------------------------------------------------------- page --- */

export default function ExamsPage() {
  const hi = useLocale() === 'hi';
  const { user, loading } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'list' });

  const header = (
    <>
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
        {hi ? 'ऑनलाइन परीक्षा' : 'Online exams'}
      </p>
      <h1 className="mt-3 flex items-center gap-3 font-display text-4xl text-secondary md:text-5xl">
        <FileQuestion className="h-9 w-9 text-primary" />
        {hi ? 'मेरी परीक्षाएँ' : 'My exams'}
      </h1>
    </>
  );

  // Auth gate: only students have a take-flow.
  if (loading) {
    return (
      <section className="container py-12 md:py-16">
        {header}
        <p className="mt-10 text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</p>
      </section>
    );
  }
  if (!user) {
    return (
      <section className="container py-12 md:py-16">
        {header}
        <Card className="mt-10 max-w-md p-6">
          <p className="text-sm text-muted-foreground">
            {hi ? 'परीक्षा देने के लिए कृपया लॉगिन करें।' : 'Please sign in to take your exams.'}
          </p>
          <Link
            href="/admin/login"
            className="mt-4 inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {hi ? 'लॉगिन' : 'Sign in'}
          </Link>
        </Card>
      </section>
    );
  }
  if (user.role !== 'student') {
    return (
      <section className="container py-12 md:py-16">
        {header}
        <Card className="mt-10 max-w-md p-6 text-sm text-muted-foreground">
          {hi
            ? 'यह पृष्ठ केवल विद्यार्थियों के लिए है।'
            : 'This page is for students only.'}
        </Card>
      </section>
    );
  }

  return (
    <section className="container py-12 md:py-16">
      {header}
      {phase.kind === 'list' && (
        <ExamList onStart={(exam) => setPhase({ kind: 'otp', exam })} />
      )}
      {phase.kind === 'otp' && (
        <OtpGate
          exam={phase.exam}
          onCancel={() => setPhase({ kind: 'list' })}
          onStarted={(r) =>
            setPhase({ kind: 'taking', exam: phase.exam, attemptId: r.attempt_id, questions: r.questions })
          }
        />
      )}
      {phase.kind === 'taking' && (
        <Taking
          exam={phase.exam}
          attemptId={phase.attemptId}
          questions={phase.questions}
          onCancel={() => setPhase({ kind: 'list' })}
          onSubmitted={(r) =>
            setPhase({ kind: 'result', exam: phase.exam, attemptId: phase.attemptId, submit: r })
          }
        />
      )}
      {phase.kind === 'result' && (
        <Result
          exam={phase.exam}
          attemptId={phase.attemptId}
          submit={phase.submit}
          onDone={() => setPhase({ kind: 'list' })}
        />
      )}
    </section>
  );
}
