/**
 * Student online-exam take-flow (mobile).
 *
 * Mirrors the /v1/exams student API and the quizzes screen's UX:
 *   available  → GET  /v1/exams/available?student_id=
 *   start      → POST /v1/exams/:id/start         (otp + student_id)
 *   submit     → POST /v1/exams/attempts/:id/submit
 *   result     → GET  /v1/exams/attempts/:id/result?student_id=
 *
 * student_id comes from useSessionView().activeStudentId (ChildSwitcher) so
 * multi-child parents hit the correct child's attempts. Query hooks stay local
 * to this screen to avoid touching the shared lib/queries.ts.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, BackHandler, Pressable, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { apiGet, apiPost, apiPut, ApiError } from "@/lib/api";
import { bodyFamily } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { Body, Button, Card, Numeric, Pill, Row, Screen, StateView, Title } from "@/components/ui";

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
  open_attempt_id: string | null;
}

interface ExamOption {
  id: string;
  option_en: string;
  option_hi: string | null;
}

interface ExamQuestion {
  id: string;
  question_en: string;
  question_hi: string | null;
  question_type: "single_choice" | "multi_choice" | "text";
  marks: number;
  options: ExamOption[];
}

interface StartResponse {
  attempt_id: string;
  questions: ExamQuestion[];
}

interface ResumeResponse {
  attempt_id: string;
  exam_id: string;
  title_en: string;
  title_hi: string | null;
  window_end: string;
  total_marks?: number;
  questions: ExamQuestion[];
  answers: {
    question_id: string;
    selected_option_ids: string[];
    text_answer: string | null;
  }[];
}

/** One row of GET /v1/exams/attempts — the student's own attempt history. */
interface AttemptHistoryRow {
  attempt_id: string;
  exam_id: string;
  title_en: string;
  title_hi: string | null;
  total_marks: number;
  pass_mark: number;
  status: string;
  needs_grading: boolean;
  result_available: boolean;
  score: number | null;
  passed: boolean | null;
  submitted_at: string | null;
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

/* --------------------------------------------------------------- queries --- */

const examKeys = {
  available: (studentId: string) => ["me", "exams", "available", studentId] as const,
  result: (attemptId: string, studentId: string) =>
    ["me", "exams", "result", attemptId, studentId] as const,
  history: (studentId: string) => ["me", "exams", "history", studentId] as const,
};

function useAvailableExams(studentId: string | undefined) {
  return useQuery({
    queryKey: examKeys.available(studentId ?? ""),
    queryFn: () =>
      apiGet<{ items: AvailableExam[] }>(
        `/v1/exams/available?student_id=${encodeURIComponent(studentId!)}`,
      ),
    enabled: !!studentId,
  });
}

function useStartExam() {
  return useMutation({
    mutationFn: ({ id, otp, student_id }: { id: string; otp?: string; student_id: string }) =>
      apiPost<StartResponse>(`/v1/exams/${id}/start`, {
        student_id,
        ...(otp ? { otp } : {}),
      }),
  });
}

function useResumeExam() {
  return useMutation({
    mutationFn: ({ attemptId, student_id }: { attemptId: string; student_id: string }) =>
      apiGet<ResumeResponse>(
        `/v1/exams/attempts/${attemptId}?student_id=${encodeURIComponent(student_id)}`,
      ),
  });
}

function hydrateAnswers(answers: ResumeResponse["answers"]): {
  selected: Record<string, string[]>;
  text: Record<string, string>;
} {
  const selected: Record<string, string[]> = {};
  const text: Record<string, string> = {};
  for (const a of answers) {
    if (a.selected_option_ids?.length) selected[a.question_id] = a.selected_option_ids;
    if (a.text_answer != null && a.text_answer.length > 0) text[a.question_id] = a.text_answer;
  }
  return { selected, text };
}

interface SubmitInput {
  attemptId: string;
  student_id: string;
  answers: {
    question_id: string;
    selected_option_ids?: string[];
    text_answer?: string;
  }[];
}

function useSubmitExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ attemptId, answers, student_id }: SubmitInput) =>
      apiPost<SubmitResponse>(`/v1/exams/attempts/${attemptId}/submit`, {
        answers,
        student_id,
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: examKeys.available(vars.student_id) });
      // A just-submitted attempt must appear under "Past exams" straight away.
      void qc.invalidateQueries({ queryKey: examKeys.history(vars.student_id) });
    },
  });
}

function useExamResult(attemptId: string | null, studentId: string | null) {
  return useQuery({
    queryKey: examKeys.result(attemptId ?? "", studentId ?? ""),
    queryFn: () =>
      apiGet<ResultResponse>(
        `/v1/exams/attempts/${attemptId}/result?student_id=${encodeURIComponent(studentId!)}`,
      ),
    enabled: !!attemptId && !!studentId,
  });
}

/**
 * The student's own attempt history. /available drops an exam the moment its
 * window closes, and the attempt_id lived only in component state, so a result
 * released afterwards was unreachable from the app entirely.
 */
function useExamHistory(studentId: string | undefined) {
  return useQuery({
    queryKey: examKeys.history(studentId ?? ""),
    queryFn: () =>
      apiGet<{ items: AttemptHistoryRow[] }>(
        `/v1/exams/attempts?student_id=${encodeURIComponent(studentId!)}`,
      ),
    enabled: !!studentId,
  });
}

/* ----------------------------------------------------------- local state --- */

interface ActiveAttempt {
  examId: string;
  titleEn: string;
  titleHi: string | null;
  totalMarks: number;
  /**
   * When the exam window shuts. Already on the wire from both /available and
   * the resume route; the screen simply never read it, so a child writing a
   * long answer past window_end had every autosave 422 silently and lost the
   * lot at submit.
   */
  windowEnd: string | null;
  attemptId: string;
  questions: ExamQuestion[];
  /** questionId -> selected option ids (single = 1 element). */
  selected: Record<string, string[]>;
  /** questionId -> text answer. */
  text: Record<string, string>;
}

/** Seconds → "1:04:09" / "9:07" / "0:12". */
function formatRemaining(total: number): string {
  const s = Math.max(0, total);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** Warn the student with five minutes to go. */
const EXPIRY_WARNING_SECONDS = 5 * 60;

function fmtRange(start: string, end: string, hi: boolean): string {
  const loc = hi ? "hi-IN" : "en-IN";
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
  try {
    return `${new Date(start).toLocaleString(loc, opts)} – ${new Date(end).toLocaleString(loc, opts)}`;
  } catch {
    return `${start} – ${end}`;
  }
}

/* ----------------------------------------------------------- result card --- */

function ResultCard({
  active,
  needsGrading,
  studentId,
  onDone,
}: {
  active: { titleEn: string; titleHi: string | null; attemptId: string };
  needsGrading: boolean;
  studentId: string;
  onDone: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const result = useExamResult(active.attemptId, studentId);
  const released = result.data && typeof result.data.score === "number";

  return (
    <>
      <Card>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Title style={{ fontSize: 18 }}>{hi ? active.titleHi ?? active.titleEn : active.titleEn}</Title>
            <Body muted style={{ fontSize: 13, marginTop: 4 }}>
              {hi ? "आपका उत्तर जमा हो गया" : "Your answers are submitted"}
            </Body>
          </View>
          <Ionicons name="checkmark-circle" size={30} color={c.successText} />
        </Row>

        {result.isLoading ? (
          <Body muted style={{ marginTop: 16, fontSize: 13 }}>
            {hi ? "परिणाम लोड हो रहा है…" : "Loading result…"}
          </Body>
        ) : result.isError ? (
          <View style={{ marginTop: 16, gap: 10 }}>
            {/* A network error used to fall through to "your result will appear
                once it is released" — presenting a connection problem as a fact
                about the exam. */}
            <Body muted style={{ fontSize: 13 }}>
              {hi
                ? "परिणाम लोड नहीं हो सका — अपना कनेक्शन जाँचें।"
                : "Could not load your result — check your connection."}
            </Body>
            <Button
              label={hi ? "पुनः प्रयास करें" : "Try again"}
              variant="ghost"
              onPress={() => void result.refetch()}
            />
          </View>
        ) : released && result.data ? (
          <>
            <Row style={{ justifyContent: "space-between", marginTop: 18, alignItems: "flex-end" }}>
              <View>
                <Body muted style={{ fontSize: 12 }}>{hi ? "अंक" : "Score"}</Body>
                <Numeric style={{ fontSize: 40, marginTop: 2 }}>
                  {result.data.score}
                </Numeric>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Body muted style={{ fontSize: 12 }}>{hi ? "कुल अंक" : "Total"}</Body>
                <Numeric style={{ fontSize: 22, marginTop: 2 }}>{result.data.total_marks ?? 0}</Numeric>
              </View>
            </Row>
            <View style={{ marginTop: 14 }}>
              <Pill
                label={
                  result.data.passed
                    ? hi
                      ? "उत्तीर्ण"
                      : "Passed"
                    : hi
                      ? "अनुत्तीर्ण"
                      : "Not passed"
                }
                tone={result.data.passed ? "success" : "error"}
              />
            </View>
            {(result.data.per_question ?? []).length > 0 ? (
              <View style={{ marginTop: 16, gap: 8 }}>
                <Body muted style={{ fontSize: 12, fontWeight: "600" }}>
                  {hi ? "उत्तर समीक्षा" : "Answer review"}
                </Body>
                {result.data.per_question!.map((pq, i) => {
                  const prompt = (hi ? pq.question_hi : pq.question_en) ?? pq.question_en;
                  return (
                    <View
                      key={pq.question_id}
                      style={{
                        borderWidth: 1,
                        borderColor: c.border,
                        borderRadius: c.radius,
                        padding: 10,
                      }}
                    >
                      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                        <Body style={{ flex: 1, fontSize: 13, fontWeight: "600", paddingRight: 8 }}>
                          {i + 1}. {prompt}
                        </Body>
                        <Body muted style={{ fontSize: 12 }}>
                          {pq.marks_awarded ?? "—"} / {pq.marks}
                        </Body>
                      </Row>
                      {pq.is_correct != null ? (
                        (() => {
                          // is_correct is "scored above zero", so a 3/10 text
                          // answer used to render a green "Correct" directly
                          // above its own partial mark — a contradictory card.
                          const awarded = pq.marks_awarded ?? 0;
                          const partial = awarded > 0 && awarded < pq.marks;
                          return (
                            <Body
                              style={{
                                marginTop: 4,
                                fontSize: 12,
                                color: partial
                                  ? c.inkDim
                                  : pq.is_correct
                                    ? c.successText
                                    : c.errorText,
                              }}
                            >
                              {partial
                                ? hi
                                  ? "आंशिक अंक"
                                  : "Partly credited"
                                : pq.is_correct
                                  ? hi
                                    ? "सही"
                                    : "Correct"
                                  : hi
                                    ? "गलत"
                                    : "Incorrect"}
                            </Body>
                          );
                        })()
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : null}
          </>
        ) : (
          <Body muted style={{ marginTop: 16, fontSize: 13 }}>
            {needsGrading || result.data?.needs_grading
              ? hi
                ? "इसमें मूल्यांकन हेतु प्रश्न हैं। परिणाम जारी होने पर दिखाई देगा।"
                : "This exam has questions awaiting grading. Your result will appear once released."
              : hi
                ? "परिणाम जारी होने पर यहाँ दिखाई देगा।"
                : "Your result will appear here once it is released."}
          </Body>
        )}
      </Card>
      <Button
        label={hi ? "परीक्षाओं पर वापस जाएँ" : "Back to exams"}
        icon="arrow-back"
        variant="outline"
        onPress={onDone}
      />
    </>
  );
}

/* --------------------------------------------------------------- screen --- */

export default function Exams() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();

  const exams = useAvailableExams(activeStudentId ?? undefined);
  const rows = exams.data?.items ?? [];

  const history = useExamHistory(activeStudentId ?? undefined);
  const historyRows = history.data?.items ?? [];

  const startExam = useStartExam();
  const resumeExam = useResumeExam();
  const submitExam = useSubmitExam();

  const [active, setActive] = useState<ActiveAttempt | null>(null);
  const [result, setResult] = useState<
    { titleEn: string; titleHi: string | null; attemptId: string; needsGrading: boolean } | null
  >(null);

  // "Not open yet" was computed once per render with no ticker, so a 10:00 exam
  // stayed disabled past 10:00 until the student pulled to refresh.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  // OTP entry state for the exam currently being started.
  const [otpFor, setOtpFor] = useState<AvailableExam | null>(null);
  const [otp, setOtp] = useState("");
  /**
   * Save state is PER QUESTION. A single global flag plus a single generation
   * counter meant only the newest request could paint: answering Q1 (save
   * fails) then Q2 (save succeeds) showed "Saved", and the failure resolved to
   * "idle", which renders nothing at all. The student closed the app believing
   * everything was stored.
   */
  const [saveState, setSaveState] = useState<
    Record<string, "saving" | "saved" | "failed">
  >({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  /** Debounced-but-not-yet-sent payloads, so exiting can flush them. */
  const pendingSaves = useRef<
    Record<string, { attemptId: string; payload: { selected_option_ids?: string[]; text_answer?: string } }>
  >({});

  function sendSave(questionId: string) {
    const queued = pendingSaves.current[questionId];
    if (!queued || !activeStudentId) return;
    delete pendingSaves.current[questionId];
    const timer = saveTimers.current[questionId];
    if (timer) {
      clearTimeout(timer);
      delete saveTimers.current[questionId];
    }
    setSaveState((s) => ({ ...s, [questionId]: "saving" }));
    void apiPut(`/v1/exams/attempts/${queued.attemptId}/answers/${questionId}`, {
      student_id: activeStudentId,
      ...queued.payload,
    })
      .then(() => {
        setSaveState((s) => ({ ...s, [questionId]: "saved" }));
      })
      .catch(() => {
        // Keep the payload so "Retry" (and the flush below) can resend it.
        pendingSaves.current[questionId] = queued;
        setSaveState((s) => ({ ...s, [questionId]: "failed" }));
      });
  }

  function flushPendingSaves() {
    for (const questionId of Object.keys(pendingSaves.current)) sendSave(questionId);
  }

  // Leaving the screen used to clearTimeout every debounced save without
  // sending it, so a sentence finished within 2s of a back-swipe vanished.
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = flushPendingSaves;
  useEffect(() => {
    return () => {
      flushRef.current();
    };
  }, []);

  function scheduleAutosave(
    attemptId: string,
    questionId: string,
    payload: { selected_option_ids?: string[]; text_answer?: string },
  ) {
    if (!activeStudentId) return;
    pendingSaves.current[questionId] = { attemptId, payload };
    const existing = saveTimers.current[questionId];
    if (existing) clearTimeout(existing);
    saveTimers.current[questionId] = setTimeout(() => sendSave(questionId), 2000);
  }

  function requestStart(exam: AvailableExam) {
    if (!activeStudentId) return;
    setResult(null);
    if (exam.open_attempt_id) {
      doResume(exam, exam.open_attempt_id);
      return;
    }
    if (exam.requires_otp) {
      setOtp("");
      setOtpFor(exam);
      return;
    }
    doStart(exam);
  }

  function doResume(exam: AvailableExam, attemptId: string) {
    if (!activeStudentId) return;
    resumeExam.mutate(
      { attemptId, student_id: activeStudentId },
      {
        onSuccess: (data) => {
          const hydrated = hydrateAnswers(data.answers ?? []);
          setSaveState({});
          setActive({
            examId: data.exam_id || exam.id,
            titleEn: data.title_en || exam.title_en,
            titleHi: data.title_hi ?? exam.title_hi,
            totalMarks: data.total_marks ?? exam.total_marks,
            windowEnd: data.window_end ?? exam.window_end,
            attemptId: data.attempt_id,
            questions: data.questions ?? [],
            selected: hydrated.selected,
            text: hydrated.text,
          });
        },
        onError: (err) => {
          const code2 = err instanceof ApiError ? err.code : "";
          Alert.alert(
            hi ? "परीक्षा जारी नहीं हुई" : "Could not resume",
            code2 === "ERR_ALREADY_SUBMITTED"
              ? hi
                ? "यह प्रयास पहले ही जमा हो चुका है।"
                : "This attempt was already submitted."
              : err instanceof Error
                ? err.message
                : hi
                  ? "कृपया पुनः प्रयास करें।"
                  : "Please try again.",
          );
          exams.refetch();
        },
      },
    );
  }

  function doStart(exam: AvailableExam, code?: string) {
    if (!activeStudentId) return;
    startExam.mutate(
      { id: exam.id, otp: code, student_id: activeStudentId },
      {
        onSuccess: (data) => {
          setOtpFor(null);
          setSaveState({});
          setActive({
            examId: exam.id,
            titleEn: exam.title_en,
            titleHi: exam.title_hi,
            totalMarks: exam.total_marks,
            windowEnd: exam.window_end,
            attemptId: data.attempt_id,
            questions: data.questions ?? [],
            selected: {},
            text: {},
          });
        },
        onError: (err) => {
          const code2 = err instanceof ApiError ? err.code : "";
          const msg =
            code2 === "ERR_OTP_INVALID"
              ? hi
                ? "गलत एक्सेस कोड।"
                : "Invalid access code."
              : code2 === "ERR_MAX_ATTEMPTS"
                ? hi
                  ? "आपके सभी प्रयास समाप्त हो गए हैं।"
                  : "You have used all your attempts."
                : code2 === "ERR_WINDOW_CLOSED"
                  ? hi
                    ? "परीक्षा का समय खुला नहीं है।"
                    : "The exam window is not open."
                  : err instanceof Error
                    ? err.message
                    : hi
                      ? "परीक्षा शुरू नहीं हो सकी।"
                      : "Could not start the exam.";
          Alert.alert(hi ? "परीक्षा शुरू नहीं हुई" : "Could not start", msg);
        },
      },
    );
  }

  function pickSingle(qid: string, optionId: string) {
    if (!active) return;
    scheduleAutosave(active.attemptId, qid, { selected_option_ids: [optionId] });
    setActive((prev) =>
      prev ? { ...prev, selected: { ...prev.selected, [qid]: [optionId] } } : prev,
    );
  }
  function toggleMulti(qid: string, optionId: string) {
    if (!active) return;
    const cur = active.selected[qid] ?? [];
    const next = cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId];
    scheduleAutosave(active.attemptId, qid, { selected_option_ids: next });
    setActive((prev) =>
      prev ? { ...prev, selected: { ...prev.selected, [qid]: next } } : prev,
    );
  }
  function setText(qid: string, value: string) {
    if (!active) return;
    scheduleAutosave(active.attemptId, qid, { text_answer: value });
    setActive((prev) => (prev ? { ...prev, text: { ...prev.text, [qid]: value } } : prev));
  }

  function doSubmit(auto = false) {
    if (!active || !activeStudentId) return;
    // The submit body is a full snapshot, so dropping the debounced saves here
    // loses nothing.
    for (const t of Object.values(saveTimers.current)) clearTimeout(t);
    saveTimers.current = {};
    pendingSaves.current = {};
    const answers = active.questions.map((q) =>
      q.question_type === "text"
        ? { question_id: q.id, text_answer: active.text[q.id] ?? "" }
        : { question_id: q.id, selected_option_ids: active.selected[q.id] ?? [] },
    );
    submitExam.mutate(
      { attemptId: active.attemptId, answers, student_id: activeStudentId },
      {
        onSuccess: (data) => {
          setResult({
            titleEn: active.titleEn,
            titleHi: active.titleHi,
            attemptId: active.attemptId,
            needsGrading: data.needs_grading,
          });
          setActive(null);
          setSaveState({});
        },
        onError: (err) => {
          const code2 = err instanceof ApiError ? err.code : "";
          // State the problem AND the fix, and never pass a raw English server
          // sentence into a Devanagari screen.
          const detail =
            code2 === "ERR_ALREADY_SUBMITTED"
              ? hi
                ? "यह प्रयास पहले ही जमा हो चुका है — अपना परिणाम देखने के लिए परीक्षा सूची पर लौटें।"
                : "This attempt was already submitted — go back to the exam list to see your result."
              : code2 === "ERR_WINDOW_CLOSED"
                ? auto
                  ? hi
                    ? "परीक्षा का समय समाप्त हो गया और यह प्रयास बंद हो गया। अपने गुरुजी या दीदी से संपर्क करें।"
                    : "The exam window closed before this could be submitted. Please tell your Guruji or Didi."
                  : hi
                    ? "परीक्षा का समय समाप्त हो चुका है — अब उत्तर जमा नहीं किए जा सकते। अपने गुरुजी या दीदी से संपर्क करें।"
                    : "The exam window has closed, so answers can no longer be submitted. Please tell your Guruji or Didi."
                : code2 === "ERR_NETWORK"
                  ? hi
                    ? "सर्वर से संपर्क नहीं हो सका — अपना कनेक्शन जाँचें और पुनः जमा करें।"
                    : "Could not reach the server — check your connection and submit again."
                  : hi
                    ? "कृपया पुनः प्रयास करें।"
                    : "Please try again.";
          Alert.alert(hi ? "जमा नहीं हुआ" : "Could not submit", detail);
        },
      },
    );
  }

  /* ---- Countdown, T-5 warning, and auto-submit at zero ------------------ */

  const expiryMs = useMemo(() => {
    if (!active?.windowEnd) return null;
    const t = new Date(active.windowEnd).getTime();
    return Number.isNaN(t) ? null : t;
  }, [active?.windowEnd]);

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const autoSubmittedRef = useRef(false);
  const submitRef = useRef<(auto?: boolean) => void>(() => {});
  submitRef.current = doSubmit;

  useEffect(() => {
    autoSubmittedRef.current = false;
  }, [active?.attemptId]);

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
        // error, but the child is never left holding unsubmittable answers.
        autoSubmittedRef.current = true;
        submitRef.current(true);
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiryMs]);

  const expiringSoon =
    secondsLeft !== null && secondsLeft > 0 && secondsLeft <= EXPIRY_WARNING_SECONDS;
  const expired = secondsLeft !== null && secondsLeft <= 0;

  const answeredCount = active
    ? active.questions.filter((q) =>
        q.question_type === "text"
          ? (active.text[q.id] ?? "").trim().length > 0
          : (active.selected[q.id] ?? []).length > 0,
      ).length
    : 0;

  // One mis-tap on a dense screen submitted instantly and, at the usual
  // max_attempts of 1, ended the exam. Name what is unanswered.
  function confirmSubmit() {
    if (!active) return;
    const unanswered = active.questions.length - answeredCount;
    if (unanswered <= 0) {
      doSubmit();
      return;
    }
    Alert.alert(
      hi ? "परीक्षा जमा करें?" : "Submit exam?",
      hi
        ? `${unanswered} प्रश्न अनुत्तरित हैं। जमा करने के बाद उत्तर नहीं बदले जा सकते।`
        : `${unanswered} question${unanswered === 1 ? " is" : "s are"} unanswered. You cannot change your answers after submitting.`,
      [
        { text: hi ? "वापस जाएँ" : "Keep writing", style: "cancel" },
        {
          text: hi ? "जमा करें" : "Submit",
          style: "destructive",
          onPress: () => doSubmit(),
        },
      ],
    );
  }

  function confirmLeave() {
    Alert.alert(
      hi ? "परीक्षा छोड़ें?" : "Leave the exam?",
      hi
        ? "आपके सहेजे गए उत्तर सुरक्षित रहेंगे और आप बाद में जारी रख सकते हैं।"
        : "Your saved answers are kept and you can resume this attempt later.",
      [
        { text: hi ? "वापस जाएँ" : "Stay", style: "cancel" },
        {
          text: hi ? "छोड़ें" : "Leave",
          onPress: () => {
            flushPendingSaves();
            setActive(null);
          },
        },
      ],
    );
  }

  const confirmLeaveRef = useRef<() => void>(() => {});
  confirmLeaveRef.current = confirmLeave;

  // Android hardware back inside an attempt confirms rather than silently
  // dropping the screen (and the last debounced answer with it).
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      confirmLeaveRef.current();
      return true;
    });
    return () => sub.remove();
  }, [active]);

  return (
    <ActivityThemed accent="exams">
      <AppHeader
        title={hi ? "परीक्षाएँ" : "Exams"}
        subtitle={hi ? "उपलब्ध ऑनलाइन परीक्षा दें" : "Take an available online exam"}
      />
      <Screen
        refreshing={exams.isRefetching}
        onRefresh={() => {
          refetch();
          exams.refetch();
        }}
      >
        {/* ---- Result ---------------------------------------------------- */}
        {result && activeStudentId ? (
          <ResultCard
            active={result}
            needsGrading={result.needsGrading}
            studentId={activeStudentId}
            onDone={() => {
              setResult(null);
              exams.refetch();
            }}
          />
        ) : active ? (
          /* ---- In-progress attempt ------------------------------------ */
          <>
            <Card>
              <Title style={{ fontSize: 18 }}>{hi ? active.titleHi ?? active.titleEn : active.titleEn}</Title>
              <Row style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                <Pill
                  label={`${answeredCount} / ${active.questions.length} ${hi ? "उत्तर दिए" : "answered"}`}
                  tone={answeredCount === active.questions.length ? "success" : "neutral"}
                />
                <Pill label={`${active.totalMarks} ${hi ? "अंक" : "marks"}`} tone="info" />
                {secondsLeft !== null ? (
                  <Pill
                    label={
                      expired
                        ? hi
                          ? "समय समाप्त"
                          : "Time up"
                        : `${hi ? "शेष" : "Time left"} ${formatRemaining(secondsLeft)}`
                    }
                    tone={expired || expiringSoon ? "warning" : "info"}
                  />
                ) : null}
              </Row>
              {expiringSoon ? (
                <Body muted style={{ marginTop: 8, fontSize: 12 }}>
                  {hi
                    ? "परीक्षा का समय समाप्त होने वाला है — समय पूरा होते ही आपके उत्तर स्वतः जमा हो जाएँगे।"
                    : "The exam window is about to close — your answers will be submitted automatically when it does."}
                </Body>
              ) : null}
              {expired ? (
                <Body muted style={{ marginTop: 8, fontSize: 12 }}>
                  {hi
                    ? "समय समाप्त हो गया — आपके उत्तर जमा किए जा रहे हैं।"
                    : "Time is up — your answers are being submitted."}
                </Body>
              ) : null}
            </Card>

            {active.questions.length === 0 ? (
              <StateView
                status="empty"
                emptyText={hi ? "इस परीक्षा में कोई प्रश्न नहीं है।" : "This exam has no questions."}
              />
            ) : (
              active.questions.map((q, qi) => {
                const selected = active.selected[q.id] ?? [];
                const prompt = (hi ? q.question_hi : q.question_en) ?? q.question_en;
                return (
                  <Card key={q.id}>
                    <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <Body style={{ flex: 1, fontSize: 15, fontWeight: "600", paddingRight: 8 }}>
                        {qi + 1}. {prompt}
                      </Body>
                      <Body muted style={{ fontSize: 12 }}>
                        {q.marks} {hi ? "अंक" : q.marks === 1 ? "mark" : "marks"}
                      </Body>
                    </Row>

                    {/* A save that never landed must not look like one that did. */}
                    {saveState[q.id] === "failed" ? (
                      <Row style={{ marginTop: 8, gap: 10, alignItems: "center" }}>
                        <Pill label={hi ? "सहेजा नहीं गया" : "Not saved"} tone="warning" />
                        <Pressable onPress={() => sendSave(q.id)} hitSlop={8}>
                          <Body style={{ fontSize: 12, color: c.primary, fontWeight: "600" }}>
                            {hi ? "पुनः प्रयास करें" : "Retry"}
                          </Body>
                        </Pressable>
                      </Row>
                    ) : saveState[q.id] === "saving" ? (
                      <Row style={{ marginTop: 8 }}>
                        <Pill label={hi ? "सहेजा जा रहा है…" : "Saving…"} tone="neutral" />
                      </Row>
                    ) : saveState[q.id] === "saved" ? (
                      <Row style={{ marginTop: 8 }}>
                        <Pill label={hi ? "सहेजा गया" : "Saved"} tone="success" />
                      </Row>
                    ) : null}

                    {q.question_type === "text" ? (
                      <TextInput
                        value={active.text[q.id] ?? ""}
                        onChangeText={(v) => setText(q.id, v)}
                        editable={!expired}
                        placeholder={hi ? "अपना उत्तर लिखें…" : "Write your answer…"}
                        placeholderTextColor={c.inkDim}
                        multiline
                        style={{
                          marginTop: 12,
                          minHeight: 90,
                          textAlignVertical: "top",
                          borderWidth: 1,
                          borderColor: c.border,
                          borderRadius: c.radius,
                          padding: 12,
                          fontFamily: bodyFamily(hi),
                          fontSize: 15,
                          color: c.foreground,
                          backgroundColor: c.card,
                        }}
                      />
                    ) : (
                      <View style={{ marginTop: 12, gap: 8 }}>
                        {q.options.map((opt) => {
                          const isOn = selected.includes(opt.id);
                          const multi = q.question_type === "multi_choice";
                          const label = (hi ? opt.option_hi : opt.option_en) ?? opt.option_en;
                          return (
                            <Pressable
                              key={opt.id}
                              onPress={() => (multi ? toggleMulti(q.id, opt.id) : pickSingle(q.id, opt.id))}
                              disabled={expired}
                              accessibilityRole={multi ? "checkbox" : "radio"}
                              accessibilityState={{ checked: isOn, disabled: expired }}
                              accessibilityLabel={label}
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 10,
                                borderWidth: 1,
                                borderColor: isOn ? c.primary : c.border,
                                backgroundColor: isOn ? c.accent : c.card,
                                borderRadius: c.radius,
                                paddingVertical: 12,
                                paddingHorizontal: 14,
                              }}
                            >
                              <Ionicons
                                name={
                                  multi
                                    ? isOn
                                      ? "checkbox"
                                      : "square-outline"
                                    : isOn
                                      ? "radio-button-on"
                                      : "radio-button-off"
                                }
                                size={20}
                                color={isOn ? c.primary : c.inkDim}
                              />
                              <Body style={{ flex: 1, color: isOn ? c.accentForeground : c.foreground }}>
                                {label}
                              </Body>
                            </Pressable>
                          );
                        })}
                        {q.question_type === "multi_choice" ? (
                          <Body muted style={{ fontSize: 12 }}>
                            {hi
                              ? "सभी सही विकल्प चुनें — आंशिक रूप से सही उत्तर पर कोई अंक नहीं मिलता।"
                              : "Select every correct option — a partly correct answer scores nothing."}
                          </Body>
                        ) : null}
                      </View>
                    )}
                  </Card>
                );
              })
            )}

            <Button
              label={hi ? "परीक्षा जमा करें" : "Submit exam"}
              icon="paper-plane"
              loading={submitExam.isPending}
              disabled={active.questions.length === 0}
              onPress={confirmSubmit}
            />
            <Button label={hi ? "छोड़ें" : "Leave"} variant="ghost" onPress={confirmLeave} />
          </>
        ) : otpFor ? (
          /* ---- OTP gate ------------------------------------------------- */
          <>
            <Card>
              <Title style={{ fontSize: 18 }}>{hi ? otpFor.title_hi ?? otpFor.title_en : otpFor.title_en}</Title>
              <Body muted style={{ marginTop: 6, fontSize: 13 }}>
                {hi
                  ? "इस परीक्षा के लिए एक्सेस कोड आवश्यक है।"
                  : "This exam needs an access code to begin."}
              </Body>
              <TextInput
                value={otp}
                onChangeText={setOtp}
                placeholder={hi ? "एक्सेस कोड" : "Access code"}
                placeholderTextColor={c.inkDim}
                autoCapitalize="characters"
                style={{
                  marginTop: 14,
                  borderWidth: 1,
                  borderColor: c.border,
                  borderRadius: c.radius,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  fontFamily: bodyFamily(hi),
                  fontSize: 16,
                  color: c.foreground,
                  backgroundColor: c.card,
                }}
              />
            </Card>
            <Button
              label={hi ? "परीक्षा शुरू करें" : "Start exam"}
              icon="play"
              loading={startExam.isPending}
              disabled={!otp.trim()}
              onPress={() => doStart(otpFor, otp.trim())}
            />
            <Button
              label={hi ? "रद्द करें" : "Cancel"}
              variant="ghost"
              onPress={() => {
                setOtpFor(null);
                setOtp("");
              }}
            />
          </>
        ) : loading ? (
          <StateView status="loading" emptyText="" />
        ) : !activeStudentId || !activeChild ? (
          <StateView
            status="empty"
            emptyText={hi ? "आपकी विद्यार्थी प्रोफ़ाइल अभी तैयार नहीं है।" : "Your student profile isn't ready yet."}
          />
        ) : (
          <>
            <ChildSwitcher />
            {exams.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : exams.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "परीक्षाएँ लोड नहीं हुईं।" : "Could not load exams."}
            onRetry={exams.refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : rows.length === 0 ? (
          <StateView
            status="empty"
            emptyText={hi ? "अभी कोई परीक्षा उपलब्ध नहीं है।" : "No exams available right now."}
          />
        ) : (
          /* ---- Available exam list ------------------------------------- */
          rows.map((exam) => {
            const now = nowTs;
            const open = now >= new Date(exam.window_start).getTime() && now <= new Date(exam.window_end).getTime();
            const upcoming = now < new Date(exam.window_start).getTime();
            const attemptsLeft = exam.max_attempts - exam.already_attempted_count;
            const exhausted = attemptsLeft <= 0;
            const canResume = !!exam.open_attempt_id;
            const isStarting =
              (startExam.isPending && startExam.variables?.id === exam.id) ||
              (resumeExam.isPending && resumeExam.variables?.attemptId === exam.open_attempt_id);
            return (
              <Card key={exam.id} style={!open || (exhausted && !canResume) ? { opacity: 0.7 } : undefined}>
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Title style={{ fontSize: 16 }}>{hi ? exam.title_hi ?? exam.title_en : exam.title_en}</Title>
                    <Body muted style={{ fontSize: 12, marginTop: 3 }}>
                      {fmtRange(exam.window_start, exam.window_end, hi)}
                    </Body>
                  </View>
                </Row>
                <Row style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                  <Pill label={`${exam.total_marks} ${hi ? "अंक" : "marks"}`} tone="neutral" />
                  <Pill
                    label={`${hi ? "शेष प्रयास" : "Attempts"} ${Math.max(0, attemptsLeft)}/${exam.max_attempts}`}
                    tone="neutral"
                  />
                  {exam.requires_otp ? (
                    <Pill label={hi ? "एक्सेस कोड" : "Access code"} tone="info" />
                  ) : null}
                  {upcoming ? (
                    <Pill label={hi ? "आगामी" : "Upcoming"} tone="warning" />
                  ) : open ? (
                    <Pill label={hi ? "खुला" : "Open"} tone="success" />
                  ) : (
                    <Pill label={hi ? "बंद" : "Closed"} tone="neutral" />
                  )}
                </Row>
                <View style={{ marginTop: 14 }}>
                  <Button
                    label={
                      canResume
                        ? hi
                          ? "परीक्षा जारी रखें"
                          : "Resume exam"
                        : exhausted
                          ? hi
                            ? "सभी प्रयास समाप्त"
                            : "No attempts left"
                          : !open
                            ? upcoming
                              ? hi
                                ? "अभी शुरू नहीं"
                                : "Not open yet"
                              : hi
                                ? "परीक्षा बंद"
                                : "Window closed"
                            : hi
                              ? "परीक्षा शुरू करें"
                              : "Start exam"
                    }
                    icon="play"
                    loading={isStarting}
                    disabled={!open || (!canResume && exhausted)}
                    onPress={() => requestStart(exam)}
                  />
                </View>
              </Card>
            );
          })
        )}

        {/* ---- Past exams ------------------------------------------------
            /available drops an exam the moment its window closes, so without
            this a result released later was unreachable from the app. */}
        {historyRows.length > 0 ? (
          <View style={{ marginTop: 22, gap: 10 }}>
            <Title style={{ fontSize: 16 }}>{hi ? "पिछली परीक्षाएँ" : "Past exams"}</Title>
            {historyRows.map((row) => {
              const title = (hi ? row.title_hi : row.title_en) ?? row.title_en;
              const note = row.result_available
                ? `${row.score} / ${row.total_marks}`
                : row.status === "in_progress"
                  ? hi
                    ? "जारी है"
                    : "In progress"
                  : row.status === "abandoned"
                    ? hi
                      ? "समय बीत जाने पर बंद — रीसेट के लिए गुरुजी या दीदी से कहें"
                      : "Closed when the window passed — ask your Guruji or Didi to reset it"
                    : row.needs_grading
                      ? hi
                        ? "मूल्यांकन बाकी है"
                        : "Awaiting grading"
                      : hi
                        ? "परिणाम अभी जारी नहीं हुआ"
                        : "Result not released yet";
              return (
                <Card key={row.attempt_id}>
                  <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Body style={{ fontSize: 14, fontWeight: "600" }}>{title}</Body>
                      <Body muted style={{ fontSize: 12, marginTop: 3 }}>
                        {note}
                      </Body>
                    </View>
                    {row.result_available && row.passed != null ? (
                      <Pill
                        label={
                          row.passed
                            ? hi
                              ? "उत्तीर्ण"
                              : "Passed"
                            : hi
                              ? "अनुत्तीर्ण"
                              : "Not passed"
                        }
                        tone={row.passed ? "success" : "error"}
                      />
                    ) : null}
                  </Row>
                  {row.result_available ? (
                    <Button
                      label={hi ? "परिणाम देखें" : "View result"}
                      variant="ghost"
                      onPress={() =>
                        setResult({
                          titleEn: row.title_en,
                          titleHi: row.title_hi,
                          attemptId: row.attempt_id,
                          needsGrading: row.needs_grading,
                        })
                      }
                    />
                  ) : null}
                </Card>
              );
            })}
          </View>
        ) : null}
          </>
        )}
      </Screen>
    </ActivityThemed>
  );
}
