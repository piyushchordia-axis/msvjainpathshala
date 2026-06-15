/**
 * Reusable quiz take-flow UI, shared by the scheduled-event and live push-quiz
 * flows on the quizzes screen. It owns the per-question answer state and renders
 * the question list + submit affordance; grading + point awards happen entirely
 * server-side (the questions arrive WITHOUT correct_indices). The parent owns
 * the start/submit mutations and the result view, so this stays presentational.
 *
 * Multi-select is supported: a question is "answered" once one or more options
 * are selected, matching the server's set-equality grading.
 */
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import type { QuizQuestion } from "@/lib/queries";
import { Body, Button, Card, Pill, Row, StateView, Title } from "@/components/ui";

export function QuizRunner({
  titleEn,
  titleHi,
  questions,
  submitting,
  onSubmit,
  onCancel,
}: {
  titleEn: string;
  titleHi: string;
  questions: QuizQuestion[];
  submitting: boolean;
  /** Called with questionId -> selected option indices. */
  onSubmit: (answers: Record<string, number[]>) => void;
  onCancel: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();

  // questionId -> selected option indices (multi-select).
  const [answers, setAnswers] = useState<Record<string, number[]>>({});

  function toggleOption(questionId: string, optionIndex: number) {
    setAnswers((prev) => {
      const current = prev[questionId] ?? [];
      const next = current.includes(optionIndex)
        ? current.filter((i) => i !== optionIndex)
        : [...current, optionIndex];
      return { ...prev, [questionId]: next };
    });
  }

  const answeredCount = useMemo(
    () => questions.filter((q) => (answers[q.id] ?? []).length > 0).length,
    [questions, answers],
  );
  const allAnswered = questions.length > 0 && answeredCount === questions.length;

  return (
    <>
      <Card>
        <Title style={{ fontSize: 18 }}>{hi ? titleHi : titleEn}</Title>
        <Row style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
          <Pill
            label={`${answeredCount} / ${questions.length} ${hi ? "उत्तर दिए" : "answered"}`}
            tone={allAnswered ? "success" : "neutral"}
          />
          <Pill
            label={hi ? "एक से अधिक विकल्प चुन सकते हैं" : "Select one or more options"}
            tone="info"
          />
        </Row>
      </Card>

      {questions.length === 0 ? (
        <StateView
          status="empty"
          emptyText={hi ? "इस प्रश्नोत्तरी में कोई प्रश्न नहीं है।" : "This quiz has no questions."}
        />
      ) : (
        questions.map((q, qi) => {
          const selected = answers[q.id] ?? [];
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
        loading={submitting}
        disabled={questions.length === 0 || answeredCount === 0}
        onPress={() => onSubmit(answers)}
      />
      <Button label={hi ? "रद्द करें" : "Cancel"} variant="ghost" onPress={onCancel} />
    </>
  );
}
