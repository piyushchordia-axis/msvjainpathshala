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
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
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
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: examKeys.available(vars.student_id) }),
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

/* ----------------------------------------------------------- local state --- */

interface ActiveAttempt {
  examId: string;
  titleEn: string;
  titleHi: string | null;
  totalMarks: number;
  attemptId: string;
  questions: ExamQuestion[];
  /** questionId -> selected option ids (single = 1 element). */
  selected: Record<string, string[]>;
  /** questionId -> text answer. */
  text: Record<string, string>;
}

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
  submit,
  studentId,
  onDone,
}: {
  active: { titleEn: string; titleHi: string | null; attemptId: string };
  submit: SubmitResponse;
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
                        <Body
                          style={{
                            marginTop: 4,
                            fontSize: 12,
                            color: pq.is_correct ? c.successText : c.errorText,
                          }}
                        >
                          {pq.is_correct
                            ? hi
                              ? "सही"
                              : "Correct"
                            : hi
                              ? "गलत"
                              : "Incorrect"}
                        </Body>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : null}
          </>
        ) : (
          <Body muted style={{ marginTop: 16, fontSize: 13 }}>
            {submit.needs_grading
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

  const startExam = useStartExam();
  const resumeExam = useResumeExam();
  const submitExam = useSubmitExam();

  const [active, setActive] = useState<ActiveAttempt | null>(null);
  const [result, setResult] = useState<
    { titleEn: string; titleHi: string | null; attemptId: string; submit: SubmitResponse } | null
  >(null);
  // OTP entry state for the exam currently being started.
  const [otpFor, setOtpFor] = useState<AvailableExam | null>(null);
  const [otp, setOtp] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const saveGen = useRef(0);

  useEffect(() => {
    return () => {
      for (const t of Object.values(saveTimers.current)) clearTimeout(t);
      saveTimers.current = {};
    };
  }, []);

  function scheduleAutosave(
    attemptId: string,
    questionId: string,
    payload: { selected_option_ids?: string[]; text_answer?: string },
  ) {
    if (!activeStudentId) return;
    const existing = saveTimers.current[questionId];
    if (existing) clearTimeout(existing);
    saveTimers.current[questionId] = setTimeout(() => {
      delete saveTimers.current[questionId];
      const gen = ++saveGen.current;
      setSaveStatus("saving");
      void apiPut(`/v1/exams/attempts/${attemptId}/answers/${questionId}`, {
        student_id: activeStudentId,
        ...payload,
      })
        .then(() => {
          if (gen === saveGen.current) setSaveStatus("saved");
        })
        .catch(() => {
          if (gen === saveGen.current) setSaveStatus("idle");
        });
    }, 2000);
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
          setSaveStatus("idle");
          setActive({
            examId: data.exam_id || exam.id,
            titleEn: data.title_en || exam.title_en,
            titleHi: data.title_hi ?? exam.title_hi,
            totalMarks: data.total_marks ?? exam.total_marks,
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
          setSaveStatus("idle");
          setActive({
            examId: exam.id,
            titleEn: exam.title_en,
            titleHi: exam.title_hi,
            totalMarks: exam.total_marks,
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

  function submit() {
    if (!active || !activeStudentId) return;
    for (const t of Object.values(saveTimers.current)) clearTimeout(t);
    saveTimers.current = {};
    const answers = active.questions.map((q) =>
      q.question_type === "text"
        ? { question_id: q.id, text_answer: active.text[q.id] ?? "" }
        : { question_id: q.id, selected_option_ids: active.selected[q.id] ?? [] },
    );
    submitExam.mutate(
      { attemptId: active.attemptId, answers, student_id: activeStudentId },
      {
        onSuccess: (data) => {
          setResult({ titleEn: active.titleEn, titleHi: active.titleHi, attemptId: active.attemptId, submit: data });
          setActive(null);
          setSaveStatus("idle");
        },
        onError: (err) => {
          const code2 = err instanceof ApiError ? err.code : "";
          Alert.alert(
            hi ? "जमा नहीं हुआ" : "Could not submit",
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
        },
      },
    );
  }

  const answeredCount = active
    ? active.questions.filter((q) =>
        q.question_type === "text"
          ? (active.text[q.id] ?? "").trim().length > 0
          : (active.selected[q.id] ?? []).length > 0,
      ).length
    : 0;

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
            submit={result.submit}
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
                {saveStatus === "saving" ? (
                  <Pill label={hi ? "सहेजा जा रहा है…" : "Saving…"} tone="neutral" />
                ) : saveStatus === "saved" ? (
                  <Pill label={hi ? "सहेजा गया" : "Saved"} tone="success" />
                ) : null}
              </Row>
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

                    {q.question_type === "text" ? (
                      <TextInput
                        value={active.text[q.id] ?? ""}
                        onChangeText={(v) => setText(q.id, v)}
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
                            {hi ? "एक या अधिक विकल्प चुनें।" : "Select one or more options."}
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
              onPress={submit}
            />
            <Button label={hi ? "छोड़ें" : "Leave"} variant="ghost" onPress={() => setActive(null)} />
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
            const now = Date.now();
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
          </>
        )}
      </Screen>
    </ActivityThemed>
  );
}
