/**
 * Student quizzes screen — two surfaces in one tab:
 *
 *  • Scheduled events: open quiz events for the active student (start → answer
 *    → submit), auto-graded server-side with participation + win punya.
 *  • Live push quiz: a shikshak-initiated quiz for the student's batch. Polled
 *    via useActivePushQuiz so it appears without a reload; a notification tap
 *    deep-links here too.
 *
 * Grading + idempotent point awards are entirely server-side; the take-flow UI
 * (QuizRunner) only collects answers. Re-submitting a completed quiz is blocked
 * by the API (409) and surfaced as a friendly "already submitted" state.
 */
import { useState } from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import {
  useAvailableQuizzes,
  useStartQuiz,
  useSubmitQuiz,
  useActivePushQuiz,
  useSubmitPushQuiz,
  type QuizEventRow,
  type QuizQuestion,
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
  titleHi: string;
  attemptId: string | null; // event attempts carry an id; push quizzes don't
  questions: QuizQuestion[];
}

/** Normalised result for the shared result card. */
interface ResultView {
  titleEn: string;
  titleHi: string;
  score: number;
  correctCount: number;
  totalCount: number;
  allCorrect: boolean;
  pointsAwarded: number;
}

function ResultCard({ result, hi, onDone, doneLabel }: { result: ResultView; hi: boolean; onDone: () => void; doneLabel: string }) {
  const c = useColors();
  return (
    <>
      <Card>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Title style={{ fontSize: 18 }}>{hi ? result.titleHi : result.titleEn}</Title>
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
          });
        },
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
    });
  }

  function submitAnswers(answers: Record<string, number[]>) {
    if (!active || !activeStudentId) return;
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
            });
            setActive(null);
          },
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
            });
            setActive(null);
          },
        },
      );
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
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
            titleEn={active.titleEn}
            titleHi={active.titleHi}
            questions={active.questions}
            submitting={submitQuiz.isPending || submitPush.isPending}
            onSubmit={submitAnswers}
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
                      {push.completion_points > 0
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
                const isStarting = startQuiz.isPending && startQuiz.variables?.id === quiz.id;
                const points = quiz.participation_points + quiz.win_points;
                const isWinner = !!quiz.is_winner;
                const pointsEarned = quiz.points_earned ?? 0;
                return (
                  <Card key={quiz.id} style={done ? { opacity: 0.65 } : undefined}>
                    <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Title style={{ fontSize: 16 }}>{hi ? quiz.title_hi : quiz.title_en}</Title>
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
                          {quiz.win_points > 0 ? (
                            <Pill label={`${hi ? "जीत" : "Win"} +${quiz.win_points}`} tone="warning" />
                          ) : null}
                          {quiz.participation_points > 0 ? (
                            <Pill label={`${hi ? "भाग" : "Take"} +${quiz.participation_points}`} tone="info" />
                          ) : null}
                          {points === 0 ? (
                            <Pill label={hi ? "अभ्यास" : "Practice"} tone="neutral" />
                          ) : null}
                        </>
                      )}
                    </Row>
                    {done ? null : (
                      <View style={{ marginTop: 14 }}>
                        <Button
                          label={hi ? "प्रश्नोत्तरी शुरू करें" : "Start quiz"}
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
          </>
        )}
      </Screen>
    </View>
  );
}
