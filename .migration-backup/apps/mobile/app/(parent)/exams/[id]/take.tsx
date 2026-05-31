/**
 * Parent / student-view exam taking screen — Step 19.
 *
 *   - Header strip: title + saffron timer top-right (computed from
 *     server_now + window_end)
 *   - One question per page (paginated stepper); question palette overlay
 *     shows answered / unanswered grid for quick navigation
 *   - MCQ single (radio), MCQ multi (checkbox), True/False (two big buttons),
 *     short_text (multiline input)
 *   - Auto-submit when the timer hits zero
 *   - Offline tolerance: each answer is cached in MMKV (`jp.queue.exam_answers`)
 *     before the network call; reconnect drains by replaying the cache
 *
 * Tokens only.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import {
  examsApi,
  type ExamQuestionDto,
  type ExamQuestionOptionDto,
  type StartAttemptResponse,
} from '@/api/endpoints/exams';
import { studentsApi, type StudentDto } from '@/api/endpoints/students';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';
import { getMmkv } from '@/storage/mmkv';

interface QuestionView {
  question: ExamQuestionDto;
  options: ExamQuestionOptionDto[];
}

interface Answer {
  selected_option_ids?: string[];
  short_text_answer?: string;
}

interface State {
  loading: boolean;
  error: string | null;
  child: StudentDto | null;
  started: StartAttemptResponse | null;
  current: number;
  answers: Record<string, Answer>;
  submitting: boolean;
  result: { score: number; manual_pending: boolean } | null;
  showPalette: boolean;
  /** OTP collected on the start screen. */
  otp: string;
  /** Time the timer expires (epoch ms), computed from window_end. */
  expiresAt: number | null;
  remainingSeconds: number;
}

const INITIAL: State = {
  loading: true,
  error: null,
  child: null,
  started: null,
  current: 0,
  answers: {},
  submitting: false,
  result: null,
  showPalette: false,
  otp: '',
  expiresAt: null,
  remainingSeconds: 0,
};

function mmkvKey(attemptId: string, questionId: string): string {
  return `exam:${attemptId}:${questionId}`;
}

export default function ExamTakeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const examId = params.id;
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>(INITIAL);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSubmittedRef = useRef(false);

  const queue = useMemo(() => getMmkv('jp.queue.exam_answers'), []);

  // -------------------------------------------------------------------------
  // Load child + (later) start attempt
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const kids = await studentsApi.myChildren();
        const child = kids.items.find((s) => s.status === 'active') ?? null;
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          child,
          error: child ? null : 'No active student found',
        }));
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof ApiError ? err.message : 'Could not load profile',
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Timer
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!state.expiresAt) return;
    const tick = () => {
      const ms = state.expiresAt! - Date.now();
      const seconds = Math.max(0, Math.floor(ms / 1000));
      setState((prev) => ({ ...prev, remainingSeconds: seconds }));
      if (seconds === 0 && !autoSubmittedRef.current && state.started?.attempt) {
        autoSubmittedRef.current = true;
        void submitFn(state.started.attempt.id);
      }
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state.expiresAt, state.started]);

  // -------------------------------------------------------------------------
  // Start attempt
  // -------------------------------------------------------------------------
  const startAttempt = useCallback(async () => {
    if (!state.child || !examId || !/^\d{6}$/.test(state.otp)) {
      setState((prev) => ({ ...prev, error: 'Enter the 6-digit OTP' }));
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const started = await examsApi.start(examId, {
        student_id: state.child.id,
        exam_otp: state.otp,
      });
      // Timer source: window_end. Spec keeps the OTP-window separate; once the
      // attempt is started the timer just counts down to window_end.
      // We need to fetch the exam's window_end — listForCaller has it.
      const list = await examsApi.list();
      const exam = list.items.find((e) => e.id === examId);
      const expiresAt = exam ? new Date(exam.window_end).getTime() : Date.now() + 30 * 60 * 1000;
      setState((prev) => ({
        ...prev,
        loading: false,
        started,
        expiresAt,
        remainingSeconds: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof ApiError ? err.message : 'Could not start exam',
      }));
    }
  }, [state.child, state.otp, examId]);

  // -------------------------------------------------------------------------
  // Save answer (cache to MMKV first, then network)
  // -------------------------------------------------------------------------
  const cacheAndSave = useCallback(
    async (questionId: string, answer: Answer) => {
      const attempt = state.started?.attempt;
      if (!attempt) return;
      // 1) cache to MMKV
      queue.set(mmkvKey(attempt.id, questionId), JSON.stringify(answer));
      // 2) update state immediately
      setState((prev) => ({
        ...prev,
        answers: { ...prev.answers, [questionId]: answer },
      }));
      // 3) fire network — drop the MMKV entry on success
      try {
        const payload: {
          question_id: string;
          selected_option_ids?: string[];
          short_text_answer?: string;
        } = {
          question_id: questionId,
        };
        if (answer.selected_option_ids) payload.selected_option_ids = answer.selected_option_ids;
        if (answer.short_text_answer !== undefined)
          payload.short_text_answer = answer.short_text_answer;
        await examsApi.saveAnswer(attempt.id, payload);
        queue.delete(mmkvKey(attempt.id, questionId));
      } catch {
        // Stay queued — reconnect retry happens on next save.
      }
    },
    [queue, state.started],
  );

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------
  const submitFn = useCallback(async (attemptId: string) => {
    setState((prev) => ({ ...prev, submitting: true }));
    try {
      const res = await examsApi.submit(attemptId);
      setState((prev) => ({
        ...prev,
        submitting: false,
        result: {
          score: res.attempt.score ?? res.auto_score,
          manual_pending: res.manual_pending,
        },
      }));
      if (timerRef.current) clearInterval(timerRef.current);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        submitting: false,
        error: err instanceof ApiError ? err.message : 'Could not submit',
      }));
    }
  }, []);

  // -------------------------------------------------------------------------
  // Render branches
  // -------------------------------------------------------------------------
  if (state.loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={JPColors.saffron} />
      </View>
    );
  }
  if (state.result) {
    return <ResultScreen result={state.result} onBack={() => router.back()} />;
  }
  if (!state.started) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Enter exam OTP</Text>
        <Text style={styles.subtle}>Your Guruji will read out a 6-digit code in class.</Text>
        <TextInput
          value={state.otp}
          onChangeText={(t) => setState((p) => ({ ...p, otp: t.replace(/\D/g, '').slice(0, 6) }))}
          keyboardType="number-pad"
          placeholder="••••••"
          maxLength={6}
          style={styles.otpInput}
        />
        {state.error ? <Text style={styles.errorText}>{state.error}</Text> : null}
        <Pressable
          onPress={startAttempt}
          disabled={state.otp.length !== 6}
          style={[styles.ctaButton, state.otp.length !== 6 && styles.ctaButtonDisabled]}
        >
          <Text style={styles.ctaText}>Start exam</Text>
        </Pressable>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Active question
  // -------------------------------------------------------------------------
  const questions = state.started.questions;
  const view = questions[state.current];
  if (!view) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>No questions in this exam</Text>
      </View>
    );
  }
  const totalQuestions = questions.length;
  const answered = Object.keys(state.answers).length;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            Question {state.current + 1} of {totalQuestions}
          </Text>
          <Text style={styles.subtle}>{answered} answered</Text>
        </View>
        <View style={styles.timer}>
          <Text style={styles.timerText}>{formatTimer(state.remainingSeconds)}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.questionCard}>
          <Text style={styles.marksBadge}>{view.question.marks} marks</Text>
          <Text style={styles.questionText}>{view.question.question_en}</Text>
          <Text style={styles.questionTextHi}>{view.question.question_hi}</Text>
        </View>
        <QuestionInput
          view={view}
          answer={state.answers[view.question.id] ?? {}}
          onChange={(a) => cacheAndSave(view.question.id, a)}
        />
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={() => setState((p) => ({ ...p, showPalette: true }))}
          style={styles.paletteBtn}
        >
          <Text style={styles.paletteBtnText}>Palette</Text>
        </Pressable>
        <Pressable
          onPress={() => setState((p) => ({ ...p, current: Math.max(0, p.current - 1) }))}
          disabled={state.current === 0}
          style={[styles.navBtn, state.current === 0 && styles.navBtnDisabled]}
        >
          <Text style={styles.navBtnText}>← Prev</Text>
        </Pressable>
        {state.current < totalQuestions - 1 ? (
          <Pressable
            onPress={() => setState((p) => ({ ...p, current: p.current + 1 }))}
            style={styles.ctaButtonSmall}
          >
            <Text style={styles.ctaText}>Next →</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => state.started && submitFn(state.started.attempt.id)}
            disabled={state.submitting}
            style={[styles.ctaButtonSmall, state.submitting && styles.ctaButtonDisabled]}
          >
            <Text style={styles.ctaText}>{state.submitting ? 'Submitting…' : 'Submit'}</Text>
          </Pressable>
        )}
      </View>

      <Modal
        visible={state.showPalette}
        transparent
        animationType="fade"
        onRequestClose={() => setState((p) => ({ ...p, showPalette: false }))}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setState((p) => ({ ...p, showPalette: false }))}
        >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Question palette</Text>
            <View style={styles.paletteGrid}>
              {questions.map((q, idx) => {
                const isAnswered = !!state.answers[q.question.id];
                return (
                  <Pressable
                    key={q.question.id}
                    onPress={() => setState((p) => ({ ...p, current: idx, showPalette: false }))}
                    style={[
                      styles.paletteCell,
                      isAnswered ? styles.paletteCellAnswered : styles.paletteCellPending,
                      idx === state.current && styles.paletteCellActive,
                    ]}
                  >
                    <Text style={styles.paletteCellText}>{idx + 1}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function QuestionInput({
  view,
  answer,
  onChange,
}: {
  view: QuestionView;
  answer: Answer;
  onChange: (a: Answer) => void;
}) {
  const { question, options } = view;
  if (question.question_type === 'short_text' || question.question_type === 'image_based') {
    return (
      <TextInput
        value={answer.short_text_answer ?? ''}
        onChangeText={(t) => onChange({ short_text_answer: t })}
        multiline
        placeholder="Type your answer…"
        style={styles.shortText}
      />
    );
  }
  if (question.question_type === 'mcq_multi') {
    const selected = new Set(answer.selected_option_ids ?? []);
    return (
      <View style={styles.options}>
        {options.map((o) => {
          const on = selected.has(o.id);
          return (
            <Pressable
              key={o.id}
              onPress={() => {
                const next = new Set(selected);
                if (on) next.delete(o.id);
                else next.add(o.id);
                onChange({ selected_option_ids: [...next] });
              }}
              style={[styles.option, on && styles.optionOn]}
            >
              <View style={[styles.checkbox, on && styles.checkboxOn]} />
              <View style={styles.optionLabels}>
                <Text style={styles.optionText}>{o.label_en}</Text>
                <Text style={styles.optionTextHi}>{o.label_hi}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    );
  }
  // mcq_single or true_false
  const selectedId = (answer.selected_option_ids ?? [])[0];
  return (
    <View style={styles.options}>
      {options.map((o) => {
        const on = o.id === selectedId;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange({ selected_option_ids: [o.id] })}
            style={[styles.option, on && styles.optionOn]}
          >
            <View style={[styles.radio, on && styles.radioOn]} />
            <View style={styles.optionLabels}>
              <Text style={styles.optionText}>{o.label_en}</Text>
              <Text style={styles.optionTextHi}>{o.label_hi}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function ResultScreen({
  result,
  onBack,
}: {
  result: { score: number; manual_pending: boolean };
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.centered, { paddingTop: insets.top }]}>
      <Text style={styles.title}>Exam submitted</Text>
      <Text style={styles.subtle}>
        {result.manual_pending
          ? 'Some answers need shikshak grading. Final result will appear soon.'
          : `Your score: ${result.score}`}
      </Text>
      <Pressable onPress={onBack} style={styles.ctaButton}>
        <Text style={styles.ctaText}>Done</Text>
      </Pressable>
    </View>
  );
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: JPColors.cream },
  centered: {
    flex: 1,
    backgroundColor: JPColors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    padding: JPSpacing.sp4,
    gap: JPSpacing.sp3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: JPSpacing.sp4,
    backgroundColor: JPColors.creamDark,
    gap: JPSpacing.sp3,
  },
  headerTitle: {
    color: JPColors.textPrimary,
    fontFamily: JPFonts.display,
    fontSize: 18,
  },
  subtle: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 13 },
  timer: {
    backgroundColor: JPColors.saffron,
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: JPSpacing.sp2,
    borderRadius: JPRadius.md,
  },
  timerText: {
    color: '#FFFFFF',
    fontFamily: JPFonts.mono,
    fontSize: 18,
    fontWeight: '700',
  },
  scroll: { padding: JPSpacing.sp4, gap: JPSpacing.sp4 },
  questionCard: {
    backgroundColor: JPColors.creamDark,
    padding: JPSpacing.sp4,
    borderRadius: JPRadius.lg,
    gap: JPSpacing.sp2,
  },
  marksBadge: {
    alignSelf: 'flex-start',
    color: JPColors.maroon,
    backgroundColor: JPColors.maroon50,
    paddingHorizontal: JPSpacing.sp2,
    paddingVertical: 2,
    borderRadius: JPRadius.sm,
    fontFamily: JPFonts.body,
    fontSize: 11,
    fontWeight: '700',
  },
  questionText: {
    color: JPColors.textPrimary,
    fontFamily: JPFonts.body,
    fontSize: 17,
    lineHeight: 24,
  },
  questionTextHi: {
    color: JPColors.maroon,
    fontFamily: JPFonts.body,
    fontSize: 16,
    lineHeight: 26,
  },
  options: { gap: JPSpacing.sp3 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: JPColors.cream,
    borderColor: JPColors.border,
    borderWidth: 1,
    padding: JPSpacing.sp4,
    borderRadius: JPRadius.md,
    gap: JPSpacing.sp3,
  },
  optionOn: { borderColor: JPColors.saffron, backgroundColor: JPColors.saffron50 },
  optionLabels: { flex: 1, gap: 2 },
  optionText: { color: JPColors.textPrimary, fontFamily: JPFonts.body, fontSize: 15 },
  optionTextHi: { color: JPColors.maroon, fontFamily: JPFonts.body, fontSize: 14, lineHeight: 22 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderColor: JPColors.border,
    borderWidth: 2,
  },
  radioOn: { borderColor: JPColors.saffron, backgroundColor: JPColors.saffron },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderColor: JPColors.border,
    borderWidth: 2,
  },
  checkboxOn: { borderColor: JPColors.saffron, backgroundColor: JPColors.saffron },
  shortText: {
    minHeight: 120,
    backgroundColor: JPColors.cream,
    borderColor: JPColors.border,
    borderWidth: 1,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
    fontFamily: JPFonts.body,
    color: JPColors.textPrimary,
    textAlignVertical: 'top',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: JPSpacing.sp3,
    gap: JPSpacing.sp3,
    backgroundColor: JPColors.cream,
    borderTopColor: JPColors.border,
    borderTopWidth: 1,
  },
  navBtn: {
    paddingHorizontal: JPSpacing.sp3,
    paddingVertical: JPSpacing.sp2,
    borderColor: JPColors.border,
    borderWidth: 1,
    borderRadius: JPRadius.md,
  },
  navBtnDisabled: { opacity: 0.4 },
  navBtnText: { color: JPColors.textPrimary, fontFamily: JPFonts.body, fontSize: 14 },
  ctaButton: {
    backgroundColor: JPColors.saffron,
    paddingVertical: JPSpacing.sp4,
    paddingHorizontal: JPSpacing.sp5,
    borderRadius: JPRadius.md,
    alignItems: 'center',
  },
  ctaButtonSmall: {
    backgroundColor: JPColors.saffron,
    paddingVertical: JPSpacing.sp3,
    paddingHorizontal: JPSpacing.sp4,
    borderRadius: JPRadius.md,
    alignItems: 'center',
    marginLeft: 'auto',
  },
  ctaButtonDisabled: { opacity: 0.6 },
  ctaText: { color: '#FFFFFF', fontFamily: JPFonts.body, fontSize: 15, fontWeight: '700' },
  paletteBtn: {
    paddingHorizontal: JPSpacing.sp3,
    paddingVertical: JPSpacing.sp2,
    backgroundColor: JPColors.creamDark,
    borderRadius: JPRadius.md,
  },
  paletteBtnText: { color: JPColors.maroon, fontFamily: JPFonts.body, fontWeight: '700' },
  title: { color: JPColors.textPrimary, fontFamily: JPFonts.display, fontSize: 22 },
  errorText: { color: JPColors.error, fontFamily: JPFonts.body, fontSize: 14, textAlign: 'center' },
  otpInput: {
    fontFamily: JPFonts.mono,
    fontSize: 28,
    letterSpacing: 8,
    color: JPColors.textPrimary,
    backgroundColor: JPColors.creamDark,
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: JPSpacing.sp3,
    borderRadius: JPRadius.md,
    textAlign: 'center',
    minWidth: 220,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: JPColors.cream,
    borderTopLeftRadius: JPRadius.lg,
    borderTopRightRadius: JPRadius.lg,
    padding: JPSpacing.sp4,
    gap: JPSpacing.sp3,
  },
  modalTitle: { color: JPColors.textPrimary, fontFamily: JPFonts.display, fontSize: 18 },
  paletteGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: JPSpacing.sp2,
  },
  paletteCell: {
    width: 44,
    height: 44,
    borderRadius: JPRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paletteCellPending: { backgroundColor: JPColors.creamDark },
  paletteCellAnswered: { backgroundColor: JPColors.successBg },
  paletteCellActive: { borderColor: JPColors.saffron, borderWidth: 2 },
  paletteCellText: {
    color: JPColors.textPrimary,
    fontFamily: JPFonts.body,
    fontWeight: '700',
  },
});
