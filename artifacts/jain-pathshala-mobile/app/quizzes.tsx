import { useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import {
  useAvailableQuizzes,
  useStartQuiz,
  useSubmitQuiz,
  type QuizEventRow,
  type QuizQuestion,
  type QuizStartResponse,
  type QuizSubmitResponse,
} from "@/lib/queries";
import { formatDateRange } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Numeric, Pill, Row, Screen, StateView, Title } from "@/components/ui";

/** Local in-progress attempt: questions returned by start + the answers map. */
interface ActiveAttempt {
  eventId: string;
  titleEn: string;
  titleHi: string;
  attemptId: string;
  questions: QuizQuestion[];
  /** questionId -> selected option indices (multi-select supported). */
  answers: Record<string, number[]>;
}

export default function Quizzes() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();

  const quizzes = useAvailableQuizzes(!!activeStudentId);
  const rows = quizzes.data?.items ?? [];

  const startQuiz = useStartQuiz();
  const submitQuiz = useSubmitQuiz();

  const [active, setActive] = useState<ActiveAttempt | null>(null);
  const [result, setResult] = useState<(QuizSubmitResponse & { titleEn: string; titleHi: string }) | null>(null);

  function beginQuiz(quiz: QuizEventRow) {
    if (!activeStudentId || quiz.already_attempted) return;
    setResult(null);
    startQuiz.mutate(
      { id: quiz.id, student_id: activeStudentId },
      {
        onSuccess: (data: QuizStartResponse) => {
          setActive({
            eventId: quiz.id,
            titleEn: quiz.title_en,
            titleHi: quiz.title_hi,
            attemptId: data.attempt_id,
            questions: data.questions ?? [],
            answers: {},
          });
        },
      },
    );
  }

  function toggleOption(questionId: string, optionIndex: number) {
    setActive((prev) => {
      if (!prev) return prev;
      const current = prev.answers[questionId] ?? [];
      const next = current.includes(optionIndex)
        ? current.filter((i) => i !== optionIndex)
        : [...current, optionIndex];
      return { ...prev, answers: { ...prev.answers, [questionId]: next } };
    });
  }

  function submit() {
    if (!active || !activeStudentId) return;
    submitQuiz.mutate(
      { id: active.eventId, student_id: activeStudentId, answers: active.answers },
      {
        onSuccess: (data: QuizSubmitResponse) => {
          setResult({ ...data, titleEn: active.titleEn, titleHi: active.titleHi });
          setActive(null);
        },
      },
    );
  }

  const answeredCount = active
    ? active.questions.filter((q) => (active.answers[q.id] ?? []).length > 0).length
    : 0;
  const allAnswered = active ? answeredCount === active.questions.length : false;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "प्रश्नोत्तरी" : "Quizzes"}
        subtitle={hi ? "उपलब्ध प्रश्नोत्तरी में भाग लें" : "Take an available quiz"}
      />
      <Screen
        refreshing={quizzes.isRefetching}
        onRefresh={() => { refetch(); quizzes.refetch(); }}
      >
        {/* ---- Result view ------------------------------------------------ */}
        {result ? (
          <>
            <Card>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Title style={{ fontSize: 18 }}>{hi ? result.titleHi : result.titleEn}</Title>
                  <Body muted style={{ fontSize: 13, marginTop: 4 }}>
                    {hi ? "आपका परिणाम" : "Your result"}
                  </Body>
                </View>
                <Ionicons name="checkmark-circle" size={30} color={c.successText} />
              </Row>
              <Row style={{ justifyContent: "space-between", marginTop: 18, alignItems: "flex-end" }}>
                <View>
                  <Body muted style={{ fontSize: 12 }}>{hi ? "अंक" : "Score"}</Body>
                  <Numeric style={{ fontSize: 40, marginTop: 2 }}>{result.score}</Numeric>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Body muted style={{ fontSize: 12 }}>{hi ? "सही उत्तर" : "Correct"}</Body>
                  <Numeric style={{ fontSize: 22, marginTop: 2 }}>
                    {result.correct_count} / {result.total_count}
                  </Numeric>
                </View>
              </Row>
            </Card>
            <Button
              label={hi ? "प्रश्नोत्तरी पर वापस जाएँ" : "Back to quizzes"}
              icon="arrow-back"
              variant="outline"
              onPress={() => { setResult(null); quizzes.refetch(); }}
            />
          </>
        ) : active ? (
          /* ---- In-progress attempt ------------------------------------- */
          <>
            <Card>
              <Title style={{ fontSize: 18 }}>{hi ? active.titleHi : active.titleEn}</Title>
              <Row style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                <Pill
                  label={`${answeredCount} / ${active.questions.length} ${hi ? "उत्तर दिए" : "answered"}`}
                  tone={allAnswered ? "success" : "neutral"}
                />
                <Pill
                  label={hi ? "एक से अधिक विकल्प चुन सकते हैं" : "Select one or more options"}
                  tone="info"
                />
              </Row>
            </Card>

            {active.questions.length === 0 ? (
              <StateView
                status="empty"
                emptyText={hi ? "इस प्रश्नोत्तरी में कोई प्रश्न नहीं है।" : "This quiz has no questions."}
              />
            ) : (
              active.questions.map((q, qi) => {
                const selected = active.answers[q.id] ?? [];
                return (
                  <Card key={q.id}>
                    <Body style={{ fontSize: 15, fontWeight: "600" }}>
                      {qi + 1}. {hi ? q.question_hi : q.question_en}
                    </Body>
                    <View style={{ marginTop: 12, gap: 8 }}>
                      {q.options.map((opt, oi) => {
                        const isOn = selected.includes(oi);
                        return (
                          <Pressable
                            key={oi}
                            onPress={() => toggleOption(q.id, oi)}
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
                              name={isOn ? "checkbox" : "square-outline"}
                              size={20}
                              color={isOn ? c.primary : c.inkDim}
                            />
                            <Body style={{ flex: 1, color: isOn ? c.accentForeground : c.foreground }}>
                              {hi ? opt.text_hi : opt.text_en}
                            </Body>
                          </Pressable>
                        );
                      })}
                    </View>
                  </Card>
                );
              })
            )}

            <Button
              label={hi ? "उत्तर जमा करें" : "Submit answers"}
              icon="paper-plane"
              loading={submitQuiz.isPending}
              disabled={active.questions.length === 0 || answeredCount === 0}
              onPress={submit}
            />
            <Button
              label={hi ? "रद्द करें" : "Cancel"}
              variant="ghost"
              onPress={() => setActive(null)}
            />
          </>
        ) : loading ? (
          <StateView status="loading" emptyText="" />
        ) : !activeStudentId || !activeChild ? (
          <StateView
            status="empty"
            emptyText={hi ? "आपकी विद्यार्थी प्रोफ़ाइल अभी तैयार नहीं है।" : "Your student profile isn't ready yet."}
          />
        ) : quizzes.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : quizzes.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "प्रश्नोत्तरी लोड नहीं हुई।" : "Could not load quizzes."}
            onRetry={quizzes.refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : rows.length === 0 ? (
          <StateView
            status="empty"
            emptyText={hi ? "अभी कोई प्रश्नोत्तरी उपलब्ध नहीं है।" : "No quizzes available right now."}
          />
        ) : (
          /* ---- Available quiz list ------------------------------------- */
          rows.map((quiz) => {
            const done = quiz.already_attempted;
            const isStarting = startQuiz.isPending && startQuiz.variables?.id === quiz.id;
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
                    <Ionicons name="checkmark-circle" size={26} color={c.successText} />
                  ) : null}
                </Row>
                <Row style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                  {typeof quiz.total_questions === "number" ? (
                    <Pill
                      label={`${quiz.total_questions} ${hi ? "प्रश्न" : "questions"}`}
                      tone="neutral"
                    />
                  ) : null}
                  {done ? (
                    <Pill label={hi ? "पूर्ण" : "Completed"} tone="success" />
                  ) : null}
                </Row>
                {done ? null : (
                  <View style={{ marginTop: 14 }}>
                    <Button
                      label={hi ? "प्रश्नोत्तरी शुरू करें" : "Start quiz"}
                      icon="play"
                      loading={isStarting}
                      onPress={() => beginQuiz(quiz)}
                    />
                  </View>
                )}
              </Card>
            );
          })
        )}
      </Screen>
    </View>
  );
}
