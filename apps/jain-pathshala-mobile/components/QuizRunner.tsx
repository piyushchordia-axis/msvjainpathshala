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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import type { QuizQuestion } from "@/lib/queries";
import { Body, Button, Card, Pill, Row, StateView, Title } from "@/components/ui";

/** Warn the child once the window is nearly up. */
const EXPIRY_WARNING_SECONDS = 60;

function formatRemaining(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function QuizRunner({
  titleEn,
  titleHi,
  questions,
  submitting,
  initialAnswers,
  expiresAt,
  onSubmit,
  onAutosave,
  onCancel,
}: {
  titleEn: string;
  titleHi: string | null;
  questions: QuizQuestion[];
  submitting: boolean;
  /** Restored selections when resuming an in-progress attempt. */
  initialAnswers?: Record<string, number[]>;
  /**
   * H9 — when this quiz stops accepting answers (event end_at / push
   * expires_at). Without it the student kept answering past the window, and
   * Submit came back 422 ERR_WINDOW_CLOSED with the runner still mounted and no
   * way out: push polling is deliberately paused during an attempt, so nothing
   * on screen ever said the quiz had closed.
   */
  expiresAt?: string | null;
  /** Called with questionId -> selected option indices. */
  onSubmit: (answers: Record<string, number[]>) => void;
  /**
   * Debounced persistence of in-progress answers. Without it, answers lived only
   * here — an app kill mid-quiz lost every one AND consumed the attempt, because
   * the server had recorded a start with `answers: {}`.
   */
  onAutosave?: (answers: Record<string, number[]>) => void;
  onCancel: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();

  // questionId -> selected option indices (multi-select).
  const [answers, setAnswers] = useState<Record<string, number[]>>(
    () => initialAnswers ?? {},
  );

  // Debounce so a burst of taps is one write, not one per tap.
  const autosaveRef = useRef(onAutosave);
  autosaveRef.current = onAutosave;
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (!dirtyRef.current) return;
    const t = setTimeout(() => {
      autosaveRef.current?.(answers);
    }, 1500);
    return () => clearTimeout(t);
  }, [answers]);

  function toggleOption(questionId: string, optionIndex: number) {
    dirtyRef.current = true;
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

  /* ---- H9: countdown, warning, and auto-submit at zero ------------------- */

  const expiryMs = useMemo(() => {
    if (!expiresAt) return null;
    const t = new Date(expiresAt).getTime();
    return Number.isNaN(t) ? null : t;
  }, [expiresAt]);

  const [secondsLeft, setSecondsLeft] = useState<number | null>(() =>
    expiryMs === null ? null : Math.round((expiryMs - Date.now()) / 1000),
  );

  // Keep the latest answers reachable from the timer without restarting it on
  // every tap — an interval that resets each keystroke never fires reliably.
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const autoSubmittedRef = useRef(false);

  useEffect(() => {
    if (expiryMs === null) return;
    const tick = () => {
      const left = Math.round((expiryMs - Date.now()) / 1000);
      setSecondsLeft(left);
      if (left <= 0 && !autoSubmittedRef.current) {
        // Send what they have rather than letting the window close on it. The
        // server is still the authority — if it has already closed we surface
        // its error, but the child is not left holding unsubmittable answers.
        autoSubmittedRef.current = true;
        submitRef.current(answersRef.current);
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiryMs]);

  const expiringSoon =
    secondsLeft !== null && secondsLeft > 0 && secondsLeft <= EXPIRY_WARNING_SECONDS;
  const expired = secondsLeft !== null && secondsLeft <= 0;

  /* ---- H8: an incomplete submit is confirmed; it is irreversible --------- */

  const doSubmit = useCallback(() => {
    submitRef.current(answersRef.current);
  }, []);

  function requestSubmit() {
    if (questions.length === 0 || answeredCount === 0) return;
    if (allAnswered) {
      doSubmit();
      return;
    }
    const unanswered = questions.length - answeredCount;
    Alert.alert(
      hi ? "अभी जमा करें?" : "Submit now?",
      hi
        ? `${unanswered} प्रश्न अभी बाकी हैं। एक बार जमा करने के बाद आप इसे दोबारा नहीं कर सकते।`
        : `${unanswered} question(s) are still unanswered. Once you submit, you cannot change your answers.`,
      [
        { text: hi ? "उत्तर देते रहें" : "Keep answering", style: "cancel" },
        { text: hi ? "फिर भी जमा करें" : "Submit anyway", style: "destructive", onPress: doSubmit },
      ],
    );
  }

  /* ---- H7: Cancel discards everything, so it asks first ------------------ */

  function requestCancel() {
    if (answeredCount === 0) {
      onCancel();
      return;
    }
    Alert.alert(
      hi ? "प्रश्नोत्तरी छोड़ें?" : "Leave this quiz?",
      hi
        ? "आपके अब तक के उत्तर सहेजे गए हैं — आप बाद में यहीं से जारी रख सकते हैं।"
        : "Your answers so far are saved — you can pick up where you left off.",
      [
        { text: hi ? "यहीं रहें" : "Stay", style: "cancel" },
        { text: hi ? "छोड़ें" : "Leave", onPress: onCancel },
      ],
    );
  }

  return (
    <>
      <Card>
        <Title style={{ fontSize: 18 }}>{hi ? titleHi ?? titleEn : titleEn}</Title>
        <Row style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
          <Pill
            label={`${answeredCount} / ${questions.length} ${hi ? "उत्तर दिए" : "answered"}`}
            tone={allAnswered ? "success" : "neutral"}
          />
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
          <Pill
            label={hi ? "एक से अधिक विकल्प चुन सकते हैं" : "Select one or more options"}
            tone="info"
          />
        </Row>
        {expiringSoon ? (
          <Body style={{ fontSize: 13, marginTop: 10, color: c.warningText }}>
            {hi
              ? "एक मिनट से भी कम बचा है — जो उत्तर दिए हैं वे अपने आप जमा हो जाएँगे।"
              : "Less than a minute left — whatever you have answered will be sent automatically."}
          </Body>
        ) : null}
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
                {qi + 1}. {hi ? q.question_hi ?? q.question_en : q.question_en}
              </Body>
              <View style={{ marginTop: 12, gap: 8 }}>
                {q.options.map((opt, oi) => {
                  const isOn = selected.includes(oi);
                  return (
                    <Pressable
                      key={oi}
                      disabled={expired || submitting}
                      onPress={() => toggleOption(q.id, oi)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isOn, disabled: expired || submitting }}
                      accessibilityLabel={hi ? opt.text_hi ?? opt.text_en : opt.text_en}
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
                        opacity: expired ? 0.6 : 1,
                      }}
                    >
                      <Ionicons
                        name={isOn ? "checkbox" : "square-outline"}
                        size={20}
                        color={isOn ? c.primary : c.inkDim}
                      />
                      <Body style={{ flex: 1, color: isOn ? c.accentForeground : c.foreground }}>
                        {hi ? opt.text_hi ?? opt.text_en : opt.text_en}
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
        disabled={questions.length === 0 || answeredCount === 0 || expired}
        onPress={requestSubmit}
      />
      <Button
        label={hi ? "रद्द करें" : "Cancel"}
        variant="ghost"
        onPress={requestCancel}
      />
    </>
  );
}
