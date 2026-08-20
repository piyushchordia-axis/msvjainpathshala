/**
 * Student quizzes screen — three surfaces in one tab:
 *
 *  • Scheduled events: open quiz events for the active student (start → answer
 *    → submit), auto-graded server-side with participation + win punya.
 *  • Live push quiz: a shikshak-initiated quiz for the student's batch, polled
 *    via useActivePushQuiz so it appears without a reload.
 *  • Past quizzes: submitted attempts with a per-question review (M8), because
 *    a quiz used to vanish the moment its window closed.
 *
 * Grading + idempotent point awards are entirely server-side; the take-flow UI
 * (QuizRunner) only collects answers. Re-submitting a completed quiz is blocked
 * by the API (409) and surfaced as a friendly "already submitted" state.
 *
 * Points shown here are the RESOLVED AT21 values and the LEDGER's record of what
 * was earned — never the raw nullable override columns, which read as 0 and
 * labelled a paying quiz as practice (C3).
 */
import { useState } from "react";
import { Alert, View } from "react-native";
import { apiErrorMessage } from "@/lib/api-error-copy";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import {
  useAvailableQuizzes,
  useStartQuiz,
  useSubmitQuiz,
  useAutosaveQuizAnswers,
  useActivePushQuiz,
  useSubmitPushQuiz,
  useQuizHistory,
  type QuizEventRow,
  type QuizQuestion,
  type QuizQuestionResult,
  type QuizStartResponse,
  type QuizSubmitResponse,
  type PushQuizActive,
  type PushQuizSubmitResponse,
} from "@/lib/queries";
import { formatDateRange } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { QuizRunner } from "@/components/QuizRunner";
import { Body, Button, Card, Numeric, Pill, Row, Screen, StateView, Title } from "@/components/ui";

/** In-progress attempt: questions from start/active + the source it came from. */
interface ActiveAttempt {
  kind: "event" | "push";
  id: string;
  titleEn: string;
  titleHi: string | null;
  attemptId: string | null; // event attempts carry an id; push quizzes don't
  questions: QuizQuestion[];
  initialAnswers?: Record<string, number[]>;
  /** H9 — when this quiz stops accepting answers (end_at / expires_at). */
  expiresAt?: string | null;
}

/** Normalised result for the shared result card. */
interface ResultView {
  titleEn: string;
  titleHi: string | null;
  score: number;
  correctCount: number;
  totalCount: number;
  allCorrect: boolean;
  pointsAwarded: number;
  /** M7 — which answers were right, so the result screen can teach. */
  questionResults?: QuizQuestionResult[];
  questions?: QuizQuestion[];
  answers?: Record<string, number[]>;
}

/**
 * M7 — the review list.
 *
 * Submit used to return counts only, so a child was told "6 / 10" and never
 * learned which four they got wrong. `question_results` was already being
 * computed — it just went to the admin rosters and not to the student. On a
 * religious-education platform this screen is the teaching moment.
 */
function AnswerReview({
  questions,
  results,
  answers,
  hi,
}: {
  questions: QuizQuestion[];
  results: QuizQuestionResult[];
  answers: Record<string, number[]>;
  hi: boolean;
}) {
  const c = useColors();
  const byId = new Map(results.map((r) => [r.question_id, r.correct]));
  const reviewable = questions.filter((q) => byId.has(q.id));
  if (reviewable.length === 0) return null;

  return (
    <Card>
      <Title style={{ fontSize: 16 }}>{hi ? "आपके उत्तर" : "Your answers"}</Title>
      <View style={{ marginTop: 12, gap: 14 }}>
        {reviewable.map((q, qi) => {
          const correct = byId.get(q.id) === true;
          const picked = answers[q.id] ?? [];
          return (
            <View key={q.id} style={{ gap: 6 }}>
              <Row style={{ gap: 8, alignItems: "flex-start" }}>
                <Ionicons
                  name={correct ? "checkmark-circle" : "close-circle"}
                  size={18}
                  color={correct ? c.successText : c.errorText}
                  style={{ marginTop: 2 }}
                />
                <Body style={{ flex: 1, fontSize: 14, fontWeight: "600" }}>
                  {qi + 1}. {hi ? q.question_hi ?? q.question_en : q.question_en}
                </Body>
              </Row>
              <View style={{ paddingLeft: 26, gap: 3 }}>
                {q.options.map((opt, oi) => {
                  const chosen = picked.includes(oi);
                  if (!chosen) return null;
                  return (
                    <Body
                      key={oi}
                      style={{ fontSize: 13, color: correct ? c.successText : c.errorText }}
                    >
                      {hi ? "आपने चुना: " : "You chose: "}
                      {hi ? opt.text_hi ?? opt.text_en : opt.text_en}
                    </Body>
                  );
                })}
                {picked.length === 0 ? (
                  <Body muted style={{ fontSize: 13 }}>
                    {hi ? "कोई उत्तर नहीं दिया" : "Not answered"}
                  </Body>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function ResultCard({ result, hi, onDone, doneLabel }: { result: ResultView; hi: boolean; onDone: () => void; doneLabel: string }) {
  const c = useColors();
  return (
    <>
      <Card>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Title style={{ fontSize: 18 }}>{hi ? result.titleHi ?? result.titleEn : result.titleEn}</Title>
            <Body muted style={{ fontSize: 13, marginTop: 4 }}>{hi ? "आपका परिणाम" : "Your result"}</Body>
          </View>
          <Ionicons
            name={result.allCorrect ? "trophy" : "checkmark-circle"}
            size={30}
            color={result.allCorrect ? c.gold : c.successText}
          />
        </Row>
        <Row style={{ justifyContent: "space-between", marginTop: 18, alignItems: "flex-end" }}>
          <View>
            <Body muted style={{ fontSize: 12 }}>{hi ? "अंक" : "Score"}</Body>
            <Numeric style={{ fontSize: 40, marginTop: 2 }}>{result.score}</Numeric>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Body muted style={{ fontSize: 12 }}>{hi ? "सही उत्तर" : "Correct"}</Body>
            <Numeric style={{ fontSize: 22, marginTop: 2 }}>
              {result.correctCount} / {result.totalCount}
            </Numeric>
          </View>
        </Row>
        <Row style={{ marginTop: 16, gap: 8, flexWrap: "wrap" }}>
          {result.allCorrect ? (
            <Pill label={hi ? "विजेता" : "Winner"} tone="warning" />
          ) : (
            <Pill label={hi ? "पूर्ण" : "Completed"} tone="success" />
          )}
          {result.pointsAwarded > 0 ? (
            <Pill
              label={
                hi
                  ? `+${result.pointsAwarded} पुण्य अर्जित`
                  : `+${result.pointsAwarded} punya earned`
              }
              tone="success"
            />
          ) : null}
        </Row>
      </Card>
      {result.questionResults && result.questions ? (
        <AnswerReview
          questions={result.questions}
          results={result.questionResults}
          answers={result.answers ?? {}}
          hi={hi}
        />
      ) : null}
      <Button label={doneLabel} icon="arrow-back" variant="outline" onPress={onDone} />
    </>
  );
}

export default function Quizzes() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();

  const quizzes = useAvailableQuizzes(activeStudentId ?? undefined);
  const rows = quizzes.data?.items ?? [];

  // Pause push polling while an attempt or result is on screen (avoids the live
  // quiz vanishing mid-attempt when it expires, and needless re-renders).
  const [active, setActive] = useState<ActiveAttempt | null>(null);
  const [result, setResult] = useState<ResultView | null>(null);

  const pushQuery = useActivePushQuiz(activeStudentId ?? undefined, !active && !result);
  const push = pushQuery.data?.active ?? null;

  const startQuiz = useStartQuiz();
  const submitQuiz = useSubmitQuiz();
  const autosaveQuiz = useAutosaveQuizAnswers();
  const submitPush = useSubmitPushQuiz();

  function beginEvent(quiz: QuizEventRow) {
    if (!activeStudentId || quiz.already_attempted) return;
    setResult(null);
    startQuiz.mutate(
      { id: quiz.id, student_id: activeStudentId },
      {
        onSuccess: (data: QuizStartResponse) => {
          setActive({
            kind: "event",
            id: quiz.id,
            titleEn: quiz.title_en,
            titleHi: quiz.title_hi,
            attemptId: data.attempt_id,
            questions: data.questions ?? [],
            initialAnswers: data.answers ?? {},
            // H9 — the runner needs the deadline to count down to.
            expiresAt: quiz.end_at,
          });
        },
        onError: (err) =>
          Alert.alert(
            hi ? "प्रश्नोत्तरी शुरू नहीं हुई" : "Couldn't start the quiz",
            apiErrorMessage(err, hi, {
              ERR_WINDOW_CLOSED: {
                en: "This quiz has closed. Ask your Guruji if it will reopen.",
                hi: "यह प्रश्नोत्तरी बंद हो चुकी है। पुनः खुलने के बारे में गुरुजी से पूछें।",
              },
              ERR_ALREADY_SUBMITTED: {
                en: "You have already completed this quiz.",
                hi: "आप यह प्रश्नोत्तरी पहले ही पूरी कर चुके हैं।",
              },
            }),
          ),
      },
    );
  }

  function beginPush(pq: PushQuizActive) {
    if (!activeStudentId || pq.already_submitted) return;
    setResult(null);
    setActive({
      kind: "push",
      id: pq.id,
      titleEn: "Live quiz",
      titleHi: "लाइव प्रश्नोत्तरी",
      attemptId: null,
      questions: pq.questions ?? [],
      // H9 — this is the one that actually expires mid-attempt, and polling is
      // paused while the runner is up, so the countdown is the only signal.
      expiresAt: pq.expires_at,
    });
  }

  /**
   * H16 — submit failures were one English alert.
   *
   * `ERR_NOT_ELIGIBLE`, `ERR_WINDOW_CLOSED` and `ERR_ALREADY_SUBMITTED` were
   * indistinguishable ("Could not submit quiz"), and the catalogue copy for
   * ERR_WINDOW_CLOSED is exam-specific — "The exam window is closed" — because
   * quizzes reuse the code (M15). Overriding per-screen keeps one code without
   * forking the catalogue.
   */
  const submitErrorCopy = {
    ERR_WINDOW_CLOSED: {
      en: "This quiz closed before your answers arrived. Ask your Guruji if it will reopen.",
      hi: "आपके उत्तर पहुँचने से पहले यह प्रश्नोत्तरी बंद हो गई। पुनः खुलने के बारे में गुरुजी से पूछें।",
    },
    ERR_ALREADY_SUBMITTED: {
      en: "You have already completed this quiz — pull down to refresh and see your result.",
      hi: "आप यह प्रश्नोत्तरी पहले ही पूरी कर चुके हैं — परिणाम देखने के लिए नीचे खींचें।",
    },
    ERR_NOT_ELIGIBLE: {
      en: "This quiz isn't open to you. Ask your Guruji which quizzes are for your age group.",
      hi: "यह प्रश्नोत्तरी आपके लिए उपलब्ध नहीं है। अपने आयु वर्ग की प्रश्नोत्तरी के बारे में गुरुजी से पूछें।",
    },
  };

  function submitAnswers(answers: Record<string, number[]>) {
    if (!active || !activeStudentId) return;
    const onSubmitError = (err: unknown) => {
      Alert.alert(
        hi ? "उत्तर जमा नहीं हुए" : "Couldn't submit your answers",
        apiErrorMessage(err, hi, submitErrorCopy),
      );
      // Whatever went wrong, leave the runner so the child is not stranded with
      // answers they can never send (H9).
      setActive(null);
    };

    if (active.kind === "event") {
      submitQuiz.mutate(
        { id: active.id, student_id: activeStudentId, answers },
        {
          onSuccess: (data: QuizSubmitResponse) => {
            setResult({
              titleEn: active.titleEn,
              titleHi: active.titleHi,
              score: data.score,
              correctCount: data.correct_count,
              totalCount: data.total_count,
              allCorrect: data.all_correct,
              pointsAwarded: data.points_awarded,
              questionResults: data.question_results,
              questions: active.questions,
              answers,
            });
            setActive(null);
          },
          onError: onSubmitError,
        },
      );
    } else {
      submitPush.mutate(
        { id: active.id, student_id: activeStudentId, answers },
        {
          onSuccess: (data: PushQuizSubmitResponse) => {
            setResult({
              titleEn: active.titleEn,
              titleHi: active.titleHi,
              score: data.score,
              correctCount: data.correct_count,
              totalCount: data.total_count,
              allCorrect: data.total_count > 0 && data.correct_count === data.total_count,
              pointsAwarded: data.points_awarded,
              questionResults: data.question_results,
              questions: active.questions,
              answers,
            });
            setActive(null);
          },
          onError: onSubmitError,
        },
      );
    }
  }

  return (
    <ActivityThemed accent="quizzes">
      <AppHeader
        title={hi ? "प्रश्नोत्तरी" : "Quizzes"}
        subtitle={hi ? "उपलब्ध प्रश्नोत्तरी में भाग लें" : "Take an available quiz"}
      />
      <Screen
        refreshing={quizzes.isRefetching}
        onRefresh={() => { refetch(); quizzes.refetch(); pushQuery.refetch(); }}
      >
        {/* ---- Result view ------------------------------------------------ */}
        {result ? (
          <ResultCard
            result={result}
            hi={hi}
            doneLabel={hi ? "प्रश्नोत्तरी पर वापस जाएँ" : "Back to quizzes"}
            onDone={() => { setResult(null); quizzes.refetch(); pushQuery.refetch(); }}
          />
        ) : active ? (
          /* ---- In-progress attempt (event or push) --------------------- */
          <QuizRunner
            key={active.attemptId ?? active.id}
            titleEn={active.titleEn}
            titleHi={active.titleHi}
            questions={active.questions}
            initialAnswers={active.initialAnswers}
            expiresAt={active.expiresAt}
            submitting={submitQuiz.isPending || submitPush.isPending}
            onSubmit={submitAnswers}
            // Only scheduled events have a server-side attempt to save against;
            // a live push quiz is graded in one shot and has no attempt row.
            onAutosave={
              active.kind === "event" && active.attemptId && activeStudentId
                ? (answers) =>
                    autosaveQuiz.mutate({
                      attemptId: active.attemptId!,
                      student_id: activeStudentId,
                      answers,
                    })
                : undefined
            }
            onCancel={() => setActive(null)}
          />
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
            {/* ---- Live push quiz (if one is active for the batch) ------- */}
            {push && !push.already_submitted ? (
              <Card style={{ borderColor: c.primary }}>
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Pill label={hi ? "लाइव अभी" : "Live now"} tone="primary" />
                    <Title style={{ fontSize: 16, marginTop: 8 }}>
                      {hi ? "कक्षा प्रश्नोत्तरी" : "Class quiz"}
                    </Title>
                    <Body muted style={{ fontSize: 12, marginTop: 3 }}>
                      {push.questions.length} {hi ? "प्रश्न" : "questions"}
                      {push.completion_points != null && push.completion_points > 0
                        ? ` · +${push.completion_points} ${hi ? "पुण्य" : "punya"}`
                        : ""}
                    </Body>
                  </View>
                  <Ionicons name="flash" size={26} color={c.primary} />
                </Row>
                <View style={{ marginTop: 14 }}>
                  <Button
                    label={hi ? "अभी भाग लें" : "Join now"}
                    icon="play"
                    onPress={() => beginPush(push)}
                  />
                </View>
              </Card>
            ) : push?.already_submitted ? (
              <Card style={{ opacity: 0.7 }}>
                <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <Title style={{ fontSize: 16 }}>{hi ? "कक्षा प्रश्नोत्तरी" : "Class quiz"}</Title>
                  <Pill label={hi ? "पूर्ण" : "Completed"} tone="success" />
                </Row>
              </Card>
            ) : null}

            {/* ---- Scheduled events ------------------------------------- */}
            {quizzes.isLoading ? (
              <StateView status="loading" emptyText="" />
            ) : quizzes.isError ? (
              <StateView
                status="error"
                emptyText=""
                errorText={hi ? "प्रश्नोत्तरी लोड नहीं हुई।" : "Could not load quizzes."}
                onRetry={quizzes.refetch}
                retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
              />
            ) : rows.length === 0 && !push ? (
              <StateView
                status="empty"
                emptyText={hi ? "अभी कोई प्रश्नोत्तरी उपलब्ध नहीं है।" : "No quizzes available right now."}
              />
            ) : (
              rows.map((quiz) => {
                const done = quiz.already_attempted;
                const inProgress = !!quiz.in_progress;
                const isStarting = startQuiz.isPending && startQuiz.variables?.id === quiz.id;
                const points = (quiz.participation_points ?? 0) + (quiz.win_points ?? 0);
                const isWinner = !!quiz.is_winner;
                const pointsEarned = quiz.points_earned ?? 0;
                return (
                  <Card key={quiz.id} style={done ? { opacity: 0.65 } : undefined}>
                    <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Title style={{ fontSize: 16 }}>{hi ? quiz.title_hi ?? quiz.title_en : quiz.title_en}</Title>
                        <Body muted style={{ fontSize: 12, marginTop: 3 }}>
                          {formatDateRange(quiz.start_at, quiz.end_at)}
                        </Body>
                      </View>
                      {done ? (
                        <Ionicons
                          name={isWinner ? "trophy" : "checkmark-circle"}
                          size={26}
                          color={isWinner ? c.gold : c.successText}
                        />
                      ) : null}
                    </Row>
                    <Row style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                      {done ? (
                        <>
                          {isWinner ? (
                            <Pill label={hi ? "विजेता" : "Winner"} tone="warning" />
                          ) : (
                            <Pill label={hi ? "पूर्ण" : "Completed"} tone="success" />
                          )}
                          {pointsEarned > 0 ? (
                            <Pill
                              label={
                                hi
                                  ? `+${pointsEarned} पुण्य अर्जित`
                                  : `+${pointsEarned} punya earned`
                              }
                              tone="success"
                            />
                          ) : null}
                        </>
                      ) : (
                        <>
                          {inProgress ? (
                            <Pill label={hi ? "जारी" : "In progress"} tone="info" />
                          ) : null}
                          {(quiz.win_points ?? 0) > 0 ? (
                            <Pill label={`${hi ? "जीत" : "Win"} +${quiz.win_points}`} tone="warning" />
                          ) : null}
                          {(quiz.participation_points ?? 0) > 0 ? (
                            <Pill label={`${hi ? "भाग" : "Take"} +${quiz.participation_points}`} tone="info" />
                          ) : null}
                          {points === 0 && !inProgress ? (
                            <Pill label={hi ? "अभ्यास" : "Practice"} tone="neutral" />
                          ) : null}
                        </>
                      )}
                    </Row>
                    {done ? null : (
                      <View style={{ marginTop: 14 }}>
                        <Button
                          label={
                            inProgress
                              ? hi
                                ? "प्रश्नोत्तरी जारी रखें"
                                : "Resume quiz"
                              : hi
                                ? "प्रश्नोत्तरी शुरू करें"
                                : "Start quiz"
                          }
                          icon="play"
                          loading={isStarting}
                          onPress={() => beginEvent(quiz)}
                        />
                      </View>
                    )}
                  </Card>
                );
              })
            )}

            {/* ---- Past quizzes (M8) ---------------------------------- */}
            <QuizHistorySection studentId={activeStudentId} hi={hi} />
          </>
        )}
      </Screen>
    </ActivityThemed>
  );
}

/**
 * M8 — quizzes used to vanish at end_at.
 *
 * `/events/available` filters `end_at >= now` and the result view lived in
 * component state, so the moment a window closed a child (or parent) could no
 * longer see what they scored, and the review screen M7 adds was one navigation
 * away from being unreachable forever. Collapsed by default so the live list
 * stays the focus, and only fetched once opened.
 */
function QuizHistorySection({ studentId, hi }: { studentId: string | null; hi: boolean }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const history = useQuizHistory(studentId ?? undefined, open);
  const items = history.data?.items ?? [];

  return (
    <>
      <Button
        label={hi ? "पिछली प्रश्नोत्तरी" : "Past quizzes"}
        icon={open ? "chevron-up" : "chevron-down"}
        variant="outline"
        onPress={() => setOpen((v) => !v)}
      />
      {!open ? null : history.isLoading ? (
        <StateView status="loading" emptyText="" />
      ) : history.isError ? (
        <StateView
          status="error"
          emptyText=""
          errorText={hi ? "पिछली प्रश्नोत्तरी लोड नहीं हुई।" : "Could not load past quizzes."}
          onRetry={history.refetch}
          retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
        />
      ) : items.length === 0 ? (
        <StateView
          status="empty"
          emptyText={hi ? "अभी तक कोई पूरी प्रश्नोत्तरी नहीं।" : "No completed quizzes yet."}
        />
      ) : (
        items.map((row) => {
          const isOpen = expanded === row.attempt_id;
          return (
            <Card key={row.attempt_id}>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Title style={{ fontSize: 15 }}>
                    {hi ? row.title_hi ?? row.title_en : row.title_en}
                  </Title>
                  <Body muted style={{ fontSize: 12, marginTop: 3 }}>
                    {formatDateRange(row.start_at, row.end_at)}
                  </Body>
                </View>
                <Ionicons
                  name={row.is_winner ? "trophy" : "checkmark-circle"}
                  size={22}
                  color={row.is_winner ? c.gold : c.successText}
                />
              </Row>
              <Row style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                <Pill
                  label={`${row.correct_count} / ${row.total_count} ${hi ? "सही" : "correct"}`}
                  tone={row.is_winner ? "warning" : "neutral"}
                />
                {row.points_earned > 0 ? (
                  <Pill
                    label={
                      hi
                        ? `+${row.points_earned} पुण्य अर्जित`
                        : `+${row.points_earned} punya earned`
                    }
                    tone="success"
                  />
                ) : null}
              </Row>
              <View style={{ marginTop: 12 }}>
                <Button
                  label={
                    isOpen
                      ? hi
                        ? "उत्तर छिपाएँ"
                        : "Hide answers"
                      : hi
                        ? "उत्तर देखें"
                        : "Review answers"
                  }
                  icon={isOpen ? "chevron-up" : "eye"}
                  variant="ghost"
                  onPress={() => setExpanded(isOpen ? null : row.attempt_id)}
                />
              </View>
              {isOpen ? (
                <View style={{ marginTop: 10, gap: 14 }}>
                  {row.questions.map((q, qi) => (
                    <View key={q.id} style={{ gap: 6 }}>
                      <Row style={{ gap: 8, alignItems: "flex-start" }}>
                        <Ionicons
                          name={q.correct ? "checkmark-circle" : "close-circle"}
                          size={18}
                          color={q.correct ? c.successText : c.errorText}
                          style={{ marginTop: 2 }}
                        />
                        <Body style={{ flex: 1, fontSize: 14, fontWeight: "600" }}>
                          {qi + 1}. {hi ? q.question_hi ?? q.question_en : q.question_en}
                        </Body>
                      </Row>
                      <View style={{ paddingLeft: 26, gap: 3 }}>
                        {q.options.map((opt, oi) => {
                          const chosen = q.selected_indices.includes(oi);
                          const isRight = q.correct_indices.includes(oi);
                          if (!chosen && !isRight) return null;
                          return (
                            <Body
                              key={oi}
                              style={{
                                fontSize: 13,
                                color: isRight ? c.successText : c.errorText,
                              }}
                            >
                              {isRight
                                ? hi
                                  ? "सही उत्तर: "
                                  : "Correct answer: "
                                : hi
                                  ? "आपने चुना: "
                                  : "You chose: "}
                              {hi ? opt.text_hi ?? opt.text_en : opt.text_en}
                            </Body>
                          );
                        })}
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </Card>
          );
        })
      )}
    </>
  );
}
