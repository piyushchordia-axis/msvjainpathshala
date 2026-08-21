/**
 * Student exam take-flow (public area, parent / student-view).
 *
 * Flow mirrors the /v1/exams take API (SPEC 6.17):
 *   list (GET /v1/exams/available?student_id=)
 *     → start (POST /v1/exams/:id/start, student_id + optional OTP)
 *     → answer (MCQ single/multi + free text)
 *     → submit (POST /v1/exams/attempts/:attemptId/submit)
 *     → result (GET /v1/exams/attempts/:attemptId/result?student_id=).
 *
 * Auth is enforced server-side; student_id comes from /v1/me/children (same
 * pattern as service-requests / mobile ChildSwitcher).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { Clock, FileQuestion, KeyRound, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react';
import { apiGet, apiPost, apiPut, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useLocale } from '@/lib/locale-context';
import { toast } from '@/components/ui/toast-jp';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/* ----------------------------------------------------------------- types --- */

interface ChildOption {
  id: string;
  full_name: string;
}

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
  /** In-progress attempt to resume after app kill; null when none. */
  open_attempt_id: string | null;
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

interface ResumeResponse {
  attempt_id: string;
  exam_id: string;
  title_en: string;
  title_hi: string | null;
  window_end: string;
  total_marks?: number;
  questions: StartQuestion[];
  answers: {
    question_id: string;
    selected_option_ids: string[];
    text_answer: string | null;
  }[];
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
  per_question?: {
    question_id: string;
    question_en: string;
    question_hi: string | null;
    marks: number;
    marks_awarded: number | null;
    is_correct: boolean | null;
  }[];
}

/** One row of GET /v1/exams/attempts — the student's own attempt history. */
interface AttemptHistoryRow {
  attempt_id: string;
  exam_id: string;
  title_en: string;
  title_hi: string | null;
  window_end: string;
  total_marks: number;
  pass_mark: number;
  status: string;
  needs_grading: boolean;
  result_available: boolean;
  score: number | null;
  passed: boolean | null;
  submitted_at: string | null;
}

/** Seconds → "1:04:09" / "9:07" / "0:12". */
function formatRemaining(total: number): string {
  const s = Math.max(0, total);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** Warn the student with five minutes to go. */
const EXPIRY_WARNING_SECONDS = 5 * 60;

/* ----------------------------------------------------- local answer state --- */

type Phase =
  | { kind: 'list' }
  | { kind: 'otp'; exam: AvailableExam }
  | {
      kind: 'taking';
      exam: AvailableExam;
      attemptId: string;
      questions: StartQuestion[];
      initialAnswers?: AnswerState;
    }
  | { kind: 'result'; title: string; attemptId: string; needsGrading: boolean };

/** questionId -> { selected option ids } | { text } */
interface AnswerState {
  selected: Record<string, string[]>;
  text: Record<string, string>;
}

function answersFromResume(answers: ResumeResponse['answers']): AnswerState {
  const selected: Record<string, string[]> = {};
  const text: Record<string, string> = {};
  for (const a of answers) {
    if (a.selected_option_ids?.length) selected[a.question_id] = a.selected_option_ids;
    if (a.text_answer != null && a.text_answer.length > 0) text[a.question_id] = a.text_answer;
  }
  return { selected, text };
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

function ExamList({
  studentId,
  onStart,
  onResumed,
}: {
  studentId: string;
  onStart: (exam: AvailableExam) => void;
  onResumed: (exam: AvailableExam, resume: ResumeResponse) => void;
}) {
  const hi = useLocale() === 'hi';
  const [items, setItems] = useState<AvailableExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  // "Not open yet" was computed once per render with no ticker, so a 10:00 exam
  // stayed disabled past 10:00 — and stayed enabled past window_end, sending the
  // student into a 422.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiGet<{ items: AvailableExam[] }>(
      `/v1/exams/available?student_id=${encodeURIComponent(studentId)}`,
    )
      .then((r) => setItems(r?.items ?? []))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : hi ? 'परीक्षाएँ लोड नहीं हुईं।' : 'Could not load exams.'),
      )
      .finally(() => setLoading(false));
  }, [hi, studentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function resume(exam: AvailableExam, attemptId: string) {
    if (resumingId) return;
    setResumingId(exam.id);
    try {
      const r = await apiGet<ResumeResponse>(
        `/v1/exams/attempts/${attemptId}?student_id=${encodeURIComponent(studentId)}`,
      );
      onResumed(exam, r);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'ERR_ALREADY_SUBMITTED') {
        toast.error(hi ? 'यह प्रयास पहले ही जमा हो चुका है।' : 'This attempt was already submitted.');
        load();
      } else {
        toast.error(
          hi ? 'परीक्षा जारी नहीं हो सकी।' : 'Could not resume the exam.',
          err instanceof ApiError ? err.message : undefined,
        );
      }
    } finally {
      setResumingId(null);
    }
  }

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

  return (
    <div className="mt-10 grid gap-4 sm:grid-cols-2">
      {items.map((ex) => {
        const title = (hi ? ex.title_hi : ex.title_en) ?? ex.title_en;
        const now = nowTs;
        const open = now >= new Date(ex.window_start).getTime() && now <= new Date(ex.window_end).getTime();
        const upcoming = now < new Date(ex.window_start).getTime();
        const attemptsLeft = ex.max_attempts - ex.already_attempted_count;
        const exhausted = attemptsLeft <= 0;
        const canResume = !!ex.open_attempt_id;
        const busy = resumingId === ex.id;
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
              disabled={!open || (!canResume && exhausted) || busy}
              onClick={() => {
                if (canResume && ex.open_attempt_id) {
                  void resume(ex, ex.open_attempt_id);
                  return;
                }
                onStart(ex);
              }}
            >
              {busy
                ? hi
                  ? 'खुल रहा है…'
                  : 'Opening…'
                : canResume
                  ? hi
                    ? 'परीक्षा जारी रखें'
                    : 'Resume exam'
                  : exhausted
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
  studentId,
  onStarted,
  onCancel,
}: {
  exam: AvailableExam;
  studentId: string;
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
      const res = await apiPost<StartResponse>(`/v1/exams/${exam.id}/start`, {
        student_id: studentId,
        ...(exam.requires_otp ? { otp: otp.trim() } : {}),
      });
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
  studentId,
  initialAnswers,
  onSubmitted,
  onCancel,
}: {
  exam: AvailableExam;
  attemptId: string;
  questions: StartQuestion[];
  studentId: string;
  initialAnswers?: AnswerState;
  onSubmitted: (r: SubmitResponse) => void;
  onCancel: () => void;
}) {
  const hi = useLocale() === 'hi';
  const [answers, setAnswers] = useState<AnswerState>(
    () => initialAnswers ?? { selected: {}, text: {} },
  );
  const [busy, setBusy] = useState(false);
  /**
   * Save state is PER QUESTION. A single global flag plus a single generation
   * counter meant only the newest request could paint: answering Q1 (save
   * fails) then Q2 (save succeeds) showed "Saved", and the failure resolved to
   * 'idle', which renders nothing at all.
   */
  const [saveState, setSaveState] = useState<Record<string, 'saving' | 'saved' | 'failed'>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  /** Debounced-but-not-yet-sent payloads, so leaving can flush them. */
  const pendingSaves = useRef<
    Record<string, { selected_option_ids?: string[]; text_answer?: string }>
  >({});

  const sendSave = useCallback(
    (questionId: string) => {
      const payload = pendingSaves.current[questionId];
      if (!payload) return;
      delete pendingSaves.current[questionId];
      const timer = saveTimers.current[questionId];
      if (timer) {
        clearTimeout(timer);
        delete saveTimers.current[questionId];
      }
      setSaveState((s) => ({ ...s, [questionId]: 'saving' }));
      void apiPut(`/v1/exams/attempts/${attemptId}/answers/${questionId}`, {
        student_id: studentId,
        ...payload,
      })
        .then(() => {
          setSaveState((s) => ({ ...s, [questionId]: 'saved' }));
        })
        .catch(() => {
          // Keep the payload so "Retry" (and the flush below) can resend it.
          pendingSaves.current[questionId] = payload;
          setSaveState((s) => ({ ...s, [questionId]: 'failed' }));
        });
    },
    [attemptId, studentId],
  );

  const flushPendingSaves = useCallback(() => {
    for (const questionId of Object.keys(pendingSaves.current)) sendSave(questionId);
  }, [sendSave]);

  // Leaving used to clearTimeout every debounced save without sending it, so a
  // sentence finished within 2s of pressing Leave simply vanished.
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = flushPendingSaves;
  useEffect(() => {
    return () => {
      flushRef.current();
    };
  }, []);

  // A refresh or tab close mid-attempt should at least warn.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(pendingSaves.current).length === 0) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  function scheduleAutosave(
    questionId: string,
    payload: { selected_option_ids?: string[]; text_answer?: string },
  ) {
    pendingSaves.current[questionId] = payload;
    const existing = saveTimers.current[questionId];
    if (existing) clearTimeout(existing);
    saveTimers.current[questionId] = setTimeout(() => sendSave(questionId), 2000);
  }

  function pickSingle(qid: string, optionId: string) {
    setAnswers((p) => ({ ...p, selected: { ...p.selected, [qid]: [optionId] } }));
    scheduleAutosave(qid, { selected_option_ids: [optionId] });
  }
  function toggleMulti(qid: string, optionId: string) {
    // Functional update: reading answers.selected from the render closure meant
    // two clicks inside one React batch autosaved the stale set, exactly as
    // pickSingle/setText already avoid.
    setAnswers((p) => {
      const cur = p.selected[qid] ?? [];
      const next = cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId];
      scheduleAutosave(qid, { selected_option_ids: next });
      return { ...p, selected: { ...p.selected, [qid]: next } };
    });
  }
  function setText(qid: string, value: string) {
    setAnswers((p) => ({ ...p, text: { ...p.text, [qid]: value } }));
    scheduleAutosave(qid, { text_answer: value });
  }

  const answeredCount = questions.filter((q) => {
    if (q.question_type === 'text') return (answers.text[q.id] ?? '').trim().length > 0;
    return (answers.selected[q.id] ?? []).length > 0;
  }).length;

  /* ---- Countdown, T-5 warning, and auto-submit at zero ------------------- */

  const expiryMs = useMemo(() => {
    const t = new Date(exam.window_end).getTime();
    return Number.isNaN(t) ? null : t;
  }, [exam.window_end]);

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const autoSubmittedRef = useRef(false);
  const submitRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (expiryMs === null) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => {
      const left = Math.round((expiryMs - Date.now()) / 1000);
      setSecondsLeft(left);
      if (left <= 0 && !autoSubmittedRef.current) {
        // Send what they have rather than letting the window close on it. The
        // server stays the authority — if it has already shut we surface that
        // error, but the student is never left holding unsubmittable answers.
        autoSubmittedRef.current = true;
        submitRef.current();
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiryMs]);

  const expiringSoon =
    secondsLeft !== null && secondsLeft > 0 && secondsLeft <= EXPIRY_WARNING_SECONDS;
  const expired = secondsLeft !== null && secondsLeft <= 0;

  // One mis-click on a dense page submitted instantly and, at the usual
  // max_attempts of 1, ended the exam. Name what is unanswered.
  function confirmSubmit() {
    const unanswered = questions.length - answeredCount;
    if (unanswered > 0) {
      const message = hi
        ? `${unanswered} प्रश्न अनुत्तरित हैं। जमा करने के बाद उत्तर नहीं बदले जा सकते। जमा करें?`
        : `${unanswered} question${unanswered === 1 ? ' is' : 's are'} unanswered. You cannot change your answers after submitting. Submit anyway?`;
      if (!window.confirm(message)) return;
    }
    void submit();
  }

  function confirmLeave() {
    const message = hi
      ? 'परीक्षा छोड़ें? आपके सहेजे गए उत्तर सुरक्षित रहेंगे और आप बाद में जारी रख सकते हैं।'
      : 'Leave the exam? Your saved answers are kept and you can resume this attempt later.';
    if (!window.confirm(message)) return;
    flushPendingSaves();
    onCancel();
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    // Flush pending debounced saves — submit body carries the full snapshot.
    for (const t of Object.values(saveTimers.current)) clearTimeout(t);
    saveTimers.current = {};
    try {
      const payload = {
        student_id: studentId,
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
      // State the problem AND the fix rather than passing a raw English server
      // sentence into a Devanagari page.
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'ERR_ALREADY_SUBMITTED') {
        toast.error(
          hi ? 'यह प्रयास पहले ही जमा हो चुका है।' : 'This attempt was already submitted.',
          hi ? 'अपना परिणाम देखने के लिए परीक्षा सूची पर लौटें।' : 'Go back to the exam list to see your result.',
        );
      } else if (code === 'ERR_WINDOW_CLOSED') {
        toast.error(
          hi ? 'परीक्षा का समय समाप्त हो चुका है।' : 'The exam window has closed.',
          hi
            ? 'अब उत्तर जमा नहीं किए जा सकते — अपने गुरुजी या दीदी को बताएँ।'
            : 'Answers can no longer be submitted — please tell your Guruji or Didi.',
        );
      } else {
        toast.error(
          hi ? 'उत्तर जमा नहीं हुए।' : 'Could not submit answers.',
          hi ? 'अपना कनेक्शन जाँचें और पुनः जमा करें।' : 'Check your connection and submit again.',
        );
      }
    } finally {
      setBusy(false);
    }
  }

  // The countdown fires this without re-subscribing its interval every render.
  submitRef.current = () => {
    void submit();
  };

  const title = (hi ? exam.title_hi : exam.title_en) ?? exam.title_en;
  return (
    <div className="mt-8 space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="font-display text-lg text-secondary">{title}</h2>
          <p className="text-sm text-muted-foreground">
            {answeredCount}/{questions.length} {hi ? 'उत्तर दिए' : 'answered'}
          </p>
          {expiringSoon ? (
            <p className="mt-1 text-xs text-status-warning">
              {hi
                ? 'परीक्षा का समय समाप्त होने वाला है — समय पूरा होते ही आपके उत्तर स्वतः जमा हो जाएँगे।'
                : 'The exam window is about to close — your answers will be submitted automatically when it does.'}
            </p>
          ) : expired ? (
            <p className="mt-1 text-xs text-status-warning">
              {hi
                ? 'समय समाप्त हो गया — आपके उत्तर जमा किए जा रहे हैं।'
                : 'Time is up — your answers are being submitted.'}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {secondsLeft !== null ? (
            <Badge variant={expired || expiringSoon ? 'destructive' : 'outline'}>
              <Clock className="mr-1 h-3 w-3" />
              {expired
                ? hi
                  ? 'समय समाप्त'
                  : 'Time up'
                : `${hi ? 'शेष' : 'Time left'} ${formatRemaining(secondsLeft)}`}
            </Badge>
          ) : null}
          <Badge variant="outline">
            {exam.total_marks} {hi ? 'अंक' : 'marks'}
          </Badge>
        </div>
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
                <p className="text-sm font-medium" id={`exam-q-${q.id}`}>
                  {i + 1}. {prompt}
                </p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {q.marks} {q.marks === 1 ? (hi ? 'अंक' : 'mark') : hi ? 'अंक' : 'marks'}
                </span>
              </div>

              {/* A save that never landed must not look like one that did. */}
              {saveState[q.id] === 'failed' ? (
                <p className="mt-2 text-xs text-status-warning">
                  {hi ? 'यह उत्तर सहेजा नहीं गया।' : 'This answer was not saved.'}{' '}
                  <button
                    type="button"
                    onClick={() => sendSave(q.id)}
                    className="underline underline-offset-2"
                  >
                    {hi ? 'पुनः प्रयास करें' : 'Retry'}
                  </button>
                </p>
              ) : saveState[q.id] === 'saving' ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {hi ? 'सहेजा जा रहा है…' : 'Saving…'}
                </p>
              ) : saveState[q.id] === 'saved' ? (
                <p className="mt-2 text-xs text-muted-foreground">{hi ? 'सहेजा गया' : 'Saved'}</p>
              ) : null}

              {q.question_type === 'text' ? (
                <Textarea
                  className="mt-3"
                  rows={4}
                  value={answers.text[q.id] ?? ''}
                  onChange={(e) => setText(q.id, e.target.value)}
                  disabled={expired}
                  aria-labelledby={`exam-q-${q.id}`}
                  placeholder={hi ? 'अपना उत्तर लिखें…' : 'Write your answer…'}
                />
              ) : (
                <div
                  className="mt-3 space-y-2"
                  role={q.question_type === 'multi_choice' ? 'group' : 'radiogroup'}
                  aria-labelledby={`exam-q-${q.id}`}
                >
                  {q.options.map((o) => {
                    const on = selected.includes(o.id);
                    const label = (hi ? o.option_hi : o.option_en) ?? o.option_en;
                    const multi = q.question_type === 'multi_choice';
                    return (
                      <button
                        key={o.id}
                        type="button"
                        // Selection was conveyed by border colour plus an icon
                        // hidden with text-transparent, so a screen reader
                        // announced four identical buttons with no idea which
                        // was chosen.
                        role={multi ? 'checkbox' : 'radio'}
                        aria-checked={on}
                        disabled={expired}
                        onClick={() => (multi ? toggleMulti(q.id, o.id) : pickSingle(q.id, o.id))}
                        className={`flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                          on
                            ? 'border-primary bg-primary/5 text-foreground'
                            : 'border-input bg-background text-foreground hover:bg-muted'
                        }`}
                      >
                        <span
                          aria-hidden="true"
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
                      {hi
                        ? 'सभी सही विकल्प चुनें — आंशिक रूप से सही उत्तर पर कोई अंक नहीं मिलता।'
                        : 'Select every correct option — a partly correct answer scores nothing.'}
                    </p>
                  ) : null}
                </div>
              )}
            </Card>
          );
        })
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button variant="outline" onClick={confirmLeave} disabled={busy}>
          {hi ? 'छोड़ें' : 'Leave'}
        </Button>
        <Button onClick={confirmSubmit} disabled={busy || questions.length === 0}>
          {busy ? (hi ? 'जमा हो रहा है…' : 'Submitting…') : hi ? 'परीक्षा जमा करें' : 'Submit exam'}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ past exams --- */

/**
 * The student's own attempt history.
 *
 * /available lists only exams whose window is still open, so the instant one
 * closed the result went with it — nothing else hands an attempt_id back, and
 * the result phase lives in component state that "Back to exams" clears. A
 * score released two weeks after the exam was simply unreachable.
 */
function PastExams({
  studentId,
  onOpen,
}: {
  studentId: string;
  onOpen: (row: AttemptHistoryRow) => void;
}) {
  const hi = useLocale() === 'hi';
  const [rows, setRows] = useState<AttemptHistoryRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    apiGet<{ items: AttemptHistoryRow[] }>(
      `/v1/exams/attempts?student_id=${encodeURIComponent(studentId)}`,
    )
      .then((r) => setRows(r?.items ?? []))
      .catch(() => {
        setRows([]);
        // A network blip must not read as "you have never sat an exam".
        setFailed(true);
      });
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (rows === null) return null;

  if (failed) {
    return (
      <div className="mt-10">
        <h2 className="font-display text-lg text-secondary">{hi ? 'पिछली परीक्षाएँ' : 'Past exams'}</h2>
        <Card className="mt-3 flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-muted-foreground">
          {hi
            ? 'पिछली परीक्षाएँ लोड नहीं हो सकीं।'
            : 'Could not load your past exams.'}
          <Button size="sm" variant="outline" onClick={load}>
            {hi ? 'पुनः प्रयास करें' : 'Retry'}
          </Button>
        </Card>
      </div>
    );
  }

  if (rows.length === 0) return null;

  return (
    <div className="mt-10">
      <h2 className="font-display text-lg text-secondary">{hi ? 'पिछली परीक्षाएँ' : 'Past exams'}</h2>
      <div className="mt-3 space-y-3">
        {rows.map((row) => {
          const title = (hi ? row.title_hi : row.title_en) ?? row.title_en;
          let note: string;
          if (row.result_available) {
            note = `${row.score} / ${row.total_marks}`;
          } else if (row.status === 'in_progress') {
            note = hi ? 'जारी है' : 'In progress';
          } else if (row.status === 'abandoned') {
            note = hi
              ? 'समय बीत जाने पर बंद — रीसेट के लिए गुरुजी या दीदी से कहें'
              : 'Closed when the window passed — ask your Guruji or Didi to reset it';
          } else if (row.needs_grading) {
            note = hi ? 'मूल्यांकन बाकी है' : 'Awaiting grading';
          } else {
            note = hi ? 'परिणाम अभी जारी नहीं हुआ' : 'Result not released yet';
          }
          return (
            <Card key={row.attempt_id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-sm font-medium">{title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
              </div>
              <div className="flex items-center gap-2">
                {row.result_available && row.passed !== null ? (
                  <Badge variant={row.passed ? 'outline' : 'destructive'}>
                    {row.passed ? (hi ? 'उत्तीर्ण' : 'Passed') : hi ? 'अनुत्तीर्ण' : 'Not passed'}
                  </Badge>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!row.result_available}
                  onClick={() => onOpen(row)}
                >
                  {hi ? 'परिणाम देखें' : 'View result'}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ result view --- */

function Result({
  title,
  attemptId,
  needsGrading,
  studentId,
  onDone,
}: {
  title: string;
  attemptId: string;
  needsGrading: boolean;
  studentId: string;
  onDone: () => void;
}) {
  const hi = useLocale() === 'hi';
  const [result, setResult] = useState<ResultResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    apiGet<ResultResponse>(
      `/v1/exams/attempts/${attemptId}/result?student_id=${encodeURIComponent(studentId)}`,
    )
      .then((r) => {
        setResult(r ?? null);
        setFailed(false);
      })
      .catch(() => {
        setResult(null);
        setFailed(true);
      })
      .finally(() => setLoading(false));
  }, [attemptId, studentId, reloadTick]);

  const released = !!result && typeof result.score === 'number';

  return (
    <Card className="mx-auto mt-10 max-w-lg p-6">
      <h2 className="font-display text-xl text-secondary">{title}</h2>

      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</p>
      ) : failed ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            {hi
              ? 'परिणाम लोड नहीं हो सका — अपना कनेक्शन जाँचें।'
              : 'Could not load your result — check your connection.'}
          </p>
          <Button size="sm" variant="outline" onClick={() => setReloadTick((n) => n + 1)}>
            {hi ? 'पुनः प्रयास करें' : 'Try again'}
          </Button>
        </div>
      ) : !released ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-medium text-foreground">
            {hi ? 'आपका उत्तर जमा हो गया है।' : 'Your answers have been submitted.'}
          </p>
          <p className="text-sm text-muted-foreground">
            {needsGrading || result?.needs_grading
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
              <span className="inline-flex items-center gap-1.5 rounded-full bg-status-success-soft px-3 py-1 text-sm font-medium text-status-success">
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
          {result.per_question && result.per_question.length > 0 ? (
            <ul className="space-y-2 border-t border-border pt-4">
              <li className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {hi ? 'उत्तर समीक्षा' : 'Answer review'}
              </li>
              {result.per_question.map((pq, i) => {
                const prompt = (hi ? pq.question_hi : pq.question_en) ?? pq.question_en;
                return (
                  <li key={pq.question_id} className="rounded-md border border-border px-3 py-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">
                        {i + 1}. {prompt}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {pq.marks_awarded ?? '—'} / {pq.marks}
                      </span>
                    </div>
                    {pq.is_correct != null ? (
                      <p
                        className={`mt-1 text-xs font-medium ${
                          pq.is_correct ? 'text-status-success' : 'text-destructive'
                        }`}
                      >
                        {pq.is_correct
                          ? hi
                            ? 'सही'
                            : 'Correct'
                          : hi
                            ? 'गलत'
                            : 'Incorrect'}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
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
  const [children, setChildren] = useState<ChildOption[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [childrenLoading, setChildrenLoading] = useState(false);
  // A blip on /v1/me/children used to clear the list, which renders the same
  // terminal "your student profile is not ready yet" card as a genuine
  // zero-children account — with no retry short of a full reload.
  const [childrenFailed, setChildrenFailed] = useState(false);
  const [childrenReloadTick, setChildrenReloadTick] = useState(0);

  const canTake = user?.role === 'parent' || user?.role === 'student';

  useEffect(() => {
    if (!canTake) {
      setChildren([]);
      setStudentId(null);
      return;
    }
    let active = true;
    setChildrenLoading(true);
    setChildrenFailed(false);
    apiGet<{ items: ChildOption[] }>('/v1/me/children')
      .then((res) => {
        if (!active) return;
        const items = res?.items ?? [];
        setChildren(items);
        setStudentId((prev) =>
          prev && items.some((c) => c.id === prev) ? prev : (items[0]?.id ?? null),
        );
      })
      .catch(() => {
        if (!active) return;
        setChildren([]);
        setStudentId(null);
        setChildrenFailed(true);
      })
      .finally(() => {
        if (active) setChildrenLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canTake, childrenReloadTick]);

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
            href="/login?return=%2Fexams"
            className="mt-4 inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {hi ? 'लॉगिन' : 'Sign in'}
          </Link>
        </Card>
      </section>
    );
  }
  if (!canTake) {
    return (
      <section className="container py-12 md:py-16">
        {header}
        <Card className="mt-10 max-w-md p-6 text-sm text-muted-foreground">
          {hi
            ? 'यह पृष्ठ अभिभावक और विद्यार्थी दृश्य के लिए है।'
            : 'This page is for parents and student view.'}
        </Card>
      </section>
    );
  }

  if (childrenLoading) {
    return (
      <section className="container py-12 md:py-16">
        {header}
        <p className="mt-10 text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</p>
      </section>
    );
  }

  if (childrenFailed) {
    return (
      <section className="container py-12 md:py-16">
        {header}
        <Card className="mt-10 flex max-w-md flex-wrap items-center justify-between gap-3 p-6 text-sm text-muted-foreground">
          {hi
            ? 'विद्यार्थी की जानकारी लोड नहीं हो सकी — अपना कनेक्शन जाँचें।'
            : 'Could not load your student details — check your connection.'}
          <Button size="sm" variant="outline" onClick={() => setChildrenReloadTick((n) => n + 1)}>
            {hi ? 'पुनः प्रयास करें' : 'Retry'}
          </Button>
        </Card>
      </section>
    );
  }

  if (!studentId || children.length === 0) {
    return (
      <section className="container py-12 md:py-16">
        {header}
        <Card className="mt-10 max-w-md p-6 text-sm text-muted-foreground">
          {hi
            ? 'आपकी विद्यार्थी प्रोफ़ाइल अभी तैयार नहीं है।'
            : 'Your student profile is not ready yet.'}
        </Card>
      </section>
    );
  }

  return (
    <section className="container py-12 md:py-16">
      {header}
      {children.length > 1 && phase.kind === 'list' ? (
        <div className="mt-6 max-w-xs space-y-1">
          <Label className="text-xs font-medium">{hi ? 'विद्यार्थी' : 'Student'}</Label>
          <Select
            value={studentId}
            onValueChange={(id) => {
              setStudentId(id);
              setPhase({ kind: 'list' });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={hi ? 'बच्चा चुनें' : 'Choose a child'} />
            </SelectTrigger>
            <SelectContent>
              {children.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {phase.kind === 'list' && (
        <>
          <ExamList
            studentId={studentId}
            onStart={(exam) => setPhase({ kind: 'otp', exam })}
            onResumed={(exam, r) =>
              setPhase({
                kind: 'taking',
                exam,
                attemptId: r.attempt_id,
                questions: r.questions ?? [],
                initialAnswers: answersFromResume(r.answers ?? []),
              })
            }
          />
          <PastExams
            studentId={studentId}
            onOpen={(row) =>
              setPhase({
                kind: 'result',
                title: (hi ? row.title_hi : row.title_en) ?? row.title_en,
                attemptId: row.attempt_id,
                needsGrading: row.needs_grading,
              })
            }
          />
        </>
      )}
      {phase.kind === 'otp' && (
        <OtpGate
          exam={phase.exam}
          studentId={studentId}
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
          studentId={studentId}
          initialAnswers={phase.initialAnswers}
          onCancel={() => setPhase({ kind: 'list' })}
          onSubmitted={(r) =>
            setPhase({
              kind: 'result',
              title: (hi ? phase.exam.title_hi : phase.exam.title_en) ?? phase.exam.title_en,
              attemptId: phase.attemptId,
              needsGrading: r.needs_grading,
            })
          }
        />
      )}
      {phase.kind === 'result' && (
        <Result
          title={phase.title}
          attemptId={phase.attemptId}
          needsGrading={phase.needsGrading}
          studentId={studentId}
          onDone={() => setPhase({ kind: 'list' })}
        />
      )}
    </section>
  );
}
