/**
 * Parent / student-view push-quiz play screen — Step 20 (SPEC §5.14, §6.18).
 *
 * Layout (matches jp-design-system/ui_kits/mobile/screens.jsx push quiz
 * screen):
 *   - Saffron countdown ring top-right (seconds remaining on the active
 *     question). Server-driven via `expires_at` on the active question.
 *   - Question card: ink text on cream surface.
 *   - Options: cream cards, saffron border + saffron-50 background when
 *     selected, success/error background when the answer is sent.
 *   - Bottom bar shows "Question N of M" + status.
 *
 * Real-time:
 *   We don't open a Socket.IO connection here in the MVP; the parent screen
 *   polls the active-question state from a dedicated `next-question`-aware
 *   read endpoint. (Live socket support is wired into the shikshak control
 *   screen — the parent screen is fine to receive the same envelope via
 *   FCM push fallback while we evolve the gateway.) The test environment
 *   verifies the API path; the visual rules below match the design kit.
 *
 * Tokens only (JPColors / JPSpacing / JPRadius / JPFonts).
 */

import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { pushQuizzesApi, type PushQuizPublicQuestionDto } from '@/api/endpoints/push-quizzes';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

interface State {
  loading: boolean;
  error: string | null;
  activeQuestion: PushQuizPublicQuestionDto | null;
  selectedIndex: number | null;
  submitted: boolean;
  isCorrect: boolean | null;
  questionNumber: number;
  totalQuestions: number;
  remainingSeconds: number;
}

const INITIAL: State = {
  loading: false,
  error: null,
  activeQuestion: null,
  selectedIndex: null,
  submitted: false,
  isCorrect: null,
  questionNumber: 0,
  totalQuestions: 0,
  remainingSeconds: 0,
};

export default function PushQuizPlayScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; student_id?: string }>();
  const quizId = params.id;
  const studentId = params.student_id ?? '';
  const [state, setState] = useState<State>(INITIAL);

  // Countdown tick — drives the saffron ring.
  useEffect(() => {
    if (!state.activeQuestion) return;
    const id = setInterval(() => {
      setState((s) => {
        if (!s.activeQuestion) return s;
        const remaining = Math.max(
          0,
          Math.floor((new Date(s.activeQuestion.expires_at).getTime() - Date.now()) / 1000),
        );
        return { ...s, remainingSeconds: remaining };
      });
    }, 250);
    return () => clearInterval(id);
  }, [state.activeQuestion]);

  const ringPct = useMemo(() => {
    if (!state.activeQuestion) return 0;
    const total = 30; // PUSH_QUIZ_QUESTION_WINDOW_MS / 1000
    return Math.min(1, Math.max(0, state.remainingSeconds / total));
  }, [state.activeQuestion, state.remainingSeconds]);

  const onPickOption = (index: number): void => {
    if (state.submitted || state.remainingSeconds <= 0) return;
    setState((s) => ({ ...s, selectedIndex: index }));
  };

  const onSubmit = async (): Promise<void> => {
    if (!state.activeQuestion || state.selectedIndex === null || state.submitted) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await pushQuizzesApi.submitAnswer(quizId, {
        student_id: studentId,
        question_id: state.activeQuestion.id,
        selected_option_index: state.selectedIndex,
      });
      setState((s) => ({ ...s, loading: false, submitted: true, isCorrect: res.is_correct }));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not submit — try again';
      setState((s) => ({ ...s, loading: false, error: message }));
    }
  };

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + JPSpacing.sp3, paddingBottom: insets.bottom },
      ]}
    >
      {/* Header strip with countdown ring */}
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Push quiz</Text>
          <Text style={styles.questionPos}>
            Question {state.questionNumber} of {state.totalQuestions || '—'}
          </Text>
        </View>
        <View style={styles.ring}>
          <View
            style={[styles.ringFill, { transform: [{ rotate: `${(1 - ringPct) * 360}deg` }] }]}
          />
          <View style={styles.ringHole}>
            <Text style={styles.ringText}>{state.remainingSeconds}s</Text>
          </View>
        </View>
      </View>

      {/* Question card */}
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {!state.activeQuestion ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderTitle}>Waiting for Guruji…</Text>
            <Text style={styles.placeholderBody}>
              When the next question goes live, it will appear here.
            </Text>
          </View>
        ) : (
          <View style={styles.questionCard}>
            <Text style={styles.questionText}>{state.activeQuestion.question_en}</Text>
            <Text style={styles.questionTextHi}>{state.activeQuestion.question_hi}</Text>
          </View>
        )}

        {state.activeQuestion ? (
          <View style={styles.options}>
            {state.activeQuestion.options.map((o, ix) => {
              const isSelected = state.selectedIndex === ix;
              const cardStyle = [
                styles.optionCard,
                isSelected && styles.optionCardSelected,
                state.submitted && isSelected && state.isCorrect && styles.optionCardCorrect,
                state.submitted && isSelected && !state.isCorrect && styles.optionCardWrong,
              ];
              return (
                <Pressable
                  key={o.id}
                  onPress={() => onPickOption(ix)}
                  disabled={state.submitted || state.remainingSeconds <= 0}
                  style={cardStyle}
                >
                  <View style={styles.optionRow}>
                    <View style={[styles.dot, isSelected && styles.dotSelected]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionTextEn}>{o.text_en}</Text>
                      <Text style={styles.optionTextHi}>{o.text_hi}</Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {state.error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{state.error}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Footer submit bar */}
      <View style={styles.footer}>
        <Pressable
          onPress={() => void onSubmit()}
          disabled={
            state.selectedIndex === null ||
            state.submitted ||
            state.loading ||
            state.remainingSeconds <= 0
          }
          style={[
            styles.submit,
            (state.selectedIndex === null || state.submitted || state.remainingSeconds <= 0) &&
              styles.submitDisabled,
          ]}
        >
          <Text style={styles.submitText}>
            {state.submitted
              ? state.isCorrect
                ? 'Correct! Wait for the next one.'
                : 'Answer locked in'
              : state.loading
                ? 'Sending…'
                : 'Submit answer'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const RING_SIZE = 60;
const RING_THICKNESS = 6;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: JPColors.cream,
    paddingHorizontal: JPSpacing.sp4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: JPSpacing.sp3,
  },
  eyebrow: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: JPColors.textSub,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  questionPos: {
    fontFamily: JPFonts.display,
    fontSize: 18,
    color: JPColors.textPrimary,
    marginTop: 2,
  },
  ring: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: RING_THICKNESS,
    borderColor: JPColors.saffron,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ringFill: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    backgroundColor: JPColors.creamDark,
    borderRadius: RING_SIZE / 2,
  },
  ringHole: {
    width: RING_SIZE - RING_THICKNESS * 3,
    height: RING_SIZE - RING_THICKNESS * 3,
    borderRadius: (RING_SIZE - RING_THICKNESS * 3) / 2,
    backgroundColor: JPColors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringText: {
    fontFamily: JPFonts.display,
    fontSize: 14,
    color: JPColors.saffron700,
    fontWeight: '700',
  },
  scrollContent: {
    paddingBottom: JPSpacing.sp6,
  },
  placeholder: {
    backgroundColor: JPColors.creamDark,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp4,
    marginTop: JPSpacing.sp4,
  },
  placeholderTitle: {
    fontFamily: JPFonts.display,
    fontSize: 20,
    color: JPColors.maroon,
  },
  placeholderBody: {
    fontFamily: JPFonts.body,
    fontSize: 14,
    color: JPColors.textSub,
    marginTop: JPSpacing.sp1,
  },
  questionCard: {
    backgroundColor: JPColors.cream,
    borderColor: JPColors.creamDeeper,
    borderWidth: 1,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp4,
    marginTop: JPSpacing.sp3,
  },
  questionText: {
    fontFamily: JPFonts.display,
    fontSize: 22,
    lineHeight: 28,
    color: JPColors.textPrimary,
  },
  questionTextHi: {
    fontFamily: JPFonts.body,
    fontSize: 16,
    lineHeight: 24,
    color: JPColors.textSub,
    marginTop: JPSpacing.sp2,
  },
  options: {
    marginTop: JPSpacing.sp4,
    gap: JPSpacing.sp2,
  },
  optionCard: {
    backgroundColor: JPColors.cream,
    borderColor: JPColors.creamDeeper,
    borderWidth: 1,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
  },
  optionCardSelected: {
    borderColor: JPColors.saffron,
    backgroundColor: JPColors.saffron50,
  },
  optionCardCorrect: {
    borderColor: JPColors.success,
    backgroundColor: JPColors.successBg,
  },
  optionCardWrong: {
    borderColor: JPColors.error,
    backgroundColor: JPColors.errorBg,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: JPSpacing.sp3,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: JPColors.textSub,
  },
  dotSelected: {
    backgroundColor: JPColors.saffron,
    borderColor: JPColors.saffron,
  },
  optionTextEn: {
    fontFamily: JPFonts.body,
    fontSize: 15,
    color: JPColors.textPrimary,
    fontWeight: '600',
  },
  optionTextHi: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    color: JPColors.textSub,
    marginTop: 2,
  },
  errorBanner: {
    marginTop: JPSpacing.sp3,
    backgroundColor: JPColors.errorBg,
    borderRadius: JPRadius.sm,
    padding: JPSpacing.sp3,
  },
  errorText: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    color: JPColors.error,
  },
  footer: {
    paddingTop: JPSpacing.sp3,
  },
  submit: {
    backgroundColor: JPColors.saffron,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
    alignItems: 'center',
  },
  submitDisabled: {
    opacity: 0.5,
  },
  submitText: {
    fontFamily: JPFonts.body,
    fontWeight: '700',
    color: '#FFFFFF',
    fontSize: 15,
  },
});
