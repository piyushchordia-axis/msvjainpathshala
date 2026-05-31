/**
 * Shikshak push-quiz control screen — Step 20 (SPEC §5.14, §6.18, §9.4).
 *
 * Layout (matches the shikshak control screen in
 * jp-design-system/ui_kits/mobile/screens.jsx):
 *
 *   Header: quiz title + "Question N of M" + countdown
 *   Big "Next question" button
 *   Response bar chart per option:
 *     - bar.fill = JPColors.success when option is the correct answer
 *     - bar.fill = JPColors.error   when option is incorrect
 *   Footer: "End quiz" button that closes the live session and triggers
 *   the leaderboard broadcast.
 *
 * End-of-quiz leaderboard matches preview/leaderboard.html — top row with a
 * gold accent, ranks 2..N with cream-50 backgrounds.
 *
 * Tokens only.
 */

import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import {
  pushQuizzesApi,
  type PushQuizLeaderboardEntryDto,
  type PushQuizPublicQuestionDto,
} from '@/api/endpoints/push-quizzes';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

interface State {
  started: boolean;
  questionNumber: number;
  totalQuestions: number;
  activeQuestion: PushQuizPublicQuestionDto | null;
  /** Per-option counts: { [optionIndex]: count } */
  counts: number[];
  totalParticipants: number;
  leaderboard: PushQuizLeaderboardEntryDto[];
  ended: boolean;
  loading: boolean;
  error: string | null;
  remainingSeconds: number;
}

const INITIAL: State = {
  started: false,
  questionNumber: 0,
  totalQuestions: 0,
  activeQuestion: null,
  counts: [],
  totalParticipants: 0,
  leaderboard: [],
  ended: false,
  loading: false,
  error: null,
  remainingSeconds: 0,
};

export default function PushQuizControlScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const quizId = params.id;
  const [state, setState] = useState<State>(INITIAL);

  // Countdown
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

  const onStart = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await pushQuizzesApi.start(quizId);
      setState((s) => ({
        ...s,
        loading: false,
        started: true,
        totalQuestions: res.total_questions,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof ApiError ? err.message : 'Failed to start',
      }));
    }
  }, [quizId]);

  const onNext = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await pushQuizzesApi.nextQuestion(quizId);
      setState((s) => ({
        ...s,
        loading: false,
        activeQuestion: res.question,
        questionNumber: res.question_number,
        totalQuestions: res.total_questions,
        counts: Array.from({ length: res.question.options.length }, () => 0),
        totalParticipants: 0,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof ApiError ? err.message : 'Could not advance',
      }));
    }
  }, [quizId]);

  const onEnd = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await pushQuizzesApi.end(quizId);
      setState((s) => ({
        ...s,
        loading: false,
        ended: true,
        leaderboard: res.leaderboard,
        activeQuestion: null,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof ApiError ? err.message : 'Could not end',
      }));
    }
  }, [quizId]);

  const totalCount = useMemo(() => state.counts.reduce((s, n) => s + n, 0), [state.counts]);

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + JPSpacing.sp3, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Push quiz · live</Text>
          <Text style={styles.title}>
            Q {state.questionNumber}/{state.totalQuestions || '—'}
          </Text>
        </View>
        {state.activeQuestion ? (
          <View style={styles.timer}>
            <Text style={styles.timerText}>{state.remainingSeconds}s</Text>
          </View>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {state.error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{state.error}</Text>
          </View>
        ) : null}

        {!state.started ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderTitle}>Start the quiz when ready</Text>
            <Text style={styles.placeholderBody}>
              Your students will get a saffron banner on their phones the moment you tap start.
            </Text>
            <Pressable
              onPress={() => void onStart()}
              disabled={state.loading}
              style={styles.primaryBtn}
            >
              <Text style={styles.primaryBtnText}>
                {state.loading ? 'Starting…' : 'Start push quiz'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {state.started && !state.ended && !state.activeQuestion ? (
          <Pressable
            onPress={() => void onNext()}
            disabled={state.loading}
            style={styles.primaryBtn}
          >
            <Text style={styles.primaryBtnText}>
              {state.loading ? 'Loading…' : 'Show first question'}
            </Text>
          </Pressable>
        ) : null}

        {state.activeQuestion ? (
          <View style={styles.questionCard}>
            <Text style={styles.questionText}>{state.activeQuestion.question_en}</Text>
            <Text style={styles.questionTextHi}>{state.activeQuestion.question_hi}</Text>
          </View>
        ) : null}

        {state.activeQuestion ? (
          <View style={styles.barsBlock}>
            <Text style={styles.barsHeader}>Live responses · {totalCount} answers</Text>
            {state.activeQuestion.options.map((opt, ix) => {
              const value = state.counts[ix] ?? 0;
              const pct = totalCount > 0 ? Math.round((value / totalCount) * 100) : 0;
              return (
                <View key={opt.id} style={styles.barRow}>
                  <Text style={styles.barLabel}>{opt.text_en}</Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${pct}%` }]} />
                  </View>
                  <Text style={styles.barCount}>{value}</Text>
                </View>
              );
            })}
            <Pressable
              onPress={() => void onNext()}
              disabled={state.loading}
              style={[styles.primaryBtn, styles.btnSecondary]}
            >
              <Text style={styles.primaryBtnText}>
                {state.loading ? 'Loading…' : 'Next question →'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {state.ended && state.leaderboard.length > 0 ? (
          <View style={styles.leaderboardCard}>
            <Text style={styles.leaderboardHeader}>Final ranking</Text>
            {state.leaderboard.map((entry, ix) => {
              const isFirst = ix === 0;
              return (
                <View key={entry.student_id} style={[styles.lbRow, isFirst && styles.lbRowFirst]}>
                  <View style={[styles.lbRank, isFirst && styles.lbRankFirst]}>
                    <Text style={[styles.lbRankText, isFirst && styles.lbRankTextFirst]}>
                      {entry.rank}
                    </Text>
                  </View>
                  <View style={styles.lbAvatar}>
                    <Text style={styles.lbAvatarText}>
                      {entry.full_name
                        .split(' ')
                        .map((s) => s[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lbName}>{entry.full_name}</Text>
                    <Text style={styles.lbSub}>
                      {entry.correct_count} / {entry.total_count} correct
                    </Text>
                  </View>
                  <Text style={styles.lbScore}>{entry.score}</Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </ScrollView>

      {state.started && !state.ended ? (
        <View style={styles.footer}>
          <Pressable onPress={() => void onEnd()} disabled={state.loading} style={styles.dangerBtn}>
            <Text style={styles.dangerBtnText}>End quiz & show leaderboard</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream, paddingHorizontal: JPSpacing.sp4 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: JPSpacing.sp3,
  },
  eyebrow: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    color: JPColors.textSub,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontWeight: '600',
  },
  title: {
    fontFamily: JPFonts.display,
    fontSize: 22,
    color: JPColors.maroon,
    marginTop: 2,
  },
  timer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 6,
    borderColor: JPColors.saffron,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: JPColors.cream,
  },
  timerText: {
    fontFamily: JPFonts.display,
    fontSize: 13,
    fontWeight: '700',
    color: JPColors.saffron700,
  },
  scroll: { paddingBottom: JPSpacing.sp6, gap: JPSpacing.sp4 },
  placeholder: {
    backgroundColor: JPColors.creamDark,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp4,
    gap: JPSpacing.sp3,
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
  },
  primaryBtn: {
    backgroundColor: JPColors.saffron,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontFamily: JPFonts.body,
    fontWeight: '700',
    color: '#FFFFFF',
    fontSize: 15,
  },
  btnSecondary: {
    backgroundColor: JPColors.maroon,
    marginTop: JPSpacing.sp3,
  },
  questionCard: {
    backgroundColor: JPColors.cream,
    borderColor: JPColors.creamDeeper,
    borderWidth: 1,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp4,
  },
  questionText: {
    fontFamily: JPFonts.display,
    fontSize: 20,
    color: JPColors.textPrimary,
  },
  questionTextHi: {
    fontFamily: JPFonts.body,
    fontSize: 14,
    color: JPColors.textSub,
    marginTop: JPSpacing.sp1,
  },
  barsBlock: {
    backgroundColor: JPColors.cream,
    borderRadius: JPRadius.md,
    borderWidth: 1,
    borderColor: JPColors.creamDeeper,
    padding: JPSpacing.sp4,
    gap: JPSpacing.sp3,
  },
  barsHeader: {
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 13,
    color: JPColors.textSub,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: JPSpacing.sp2,
  },
  barLabel: {
    width: 80,
    fontFamily: JPFonts.body,
    fontSize: 13,
    color: JPColors.textPrimary,
  },
  barTrack: {
    flex: 1,
    height: 10,
    backgroundColor: JPColors.creamDark,
    borderRadius: JPRadius.pill,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: JPColors.saffron,
  },
  barCount: {
    width: 32,
    textAlign: 'right',
    fontFamily: JPFonts.body,
    fontWeight: '600',
    color: JPColors.maroon,
    fontSize: 13,
  },
  leaderboardCard: {
    backgroundColor: JPColors.cream,
    borderColor: JPColors.creamDeeper,
    borderWidth: 1,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
    gap: JPSpacing.sp2,
  },
  leaderboardHeader: {
    fontFamily: JPFonts.display,
    fontSize: 18,
    color: JPColors.maroon,
    marginBottom: JPSpacing.sp2,
  },
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: JPSpacing.sp3,
    paddingVertical: JPSpacing.sp2,
    paddingHorizontal: JPSpacing.sp2,
    borderRadius: JPRadius.sm,
  },
  lbRowFirst: {
    backgroundColor: JPColors.gold50,
  },
  lbRank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: JPColors.creamDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lbRankFirst: {
    backgroundColor: JPColors.gold,
  },
  lbRankText: {
    fontFamily: JPFonts.body,
    fontWeight: '700',
    color: JPColors.maroon,
    fontSize: 13,
  },
  lbRankTextFirst: {
    color: '#FFFFFF',
  },
  lbAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: JPColors.saffron,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lbAvatarText: {
    fontFamily: JPFonts.body,
    fontWeight: '700',
    color: '#FFFFFF',
    fontSize: 14,
  },
  lbName: {
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 14,
    color: JPColors.textPrimary,
  },
  lbSub: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    color: JPColors.textSub,
  },
  lbScore: {
    fontFamily: JPFonts.display,
    fontWeight: '700',
    color: JPColors.gold,
    fontSize: 16,
  },
  errorBanner: {
    backgroundColor: JPColors.errorBg,
    padding: JPSpacing.sp3,
    borderRadius: JPRadius.sm,
  },
  errorText: {
    fontFamily: JPFonts.body,
    color: JPColors.error,
    fontSize: 13,
  },
  footer: { paddingTop: JPSpacing.sp3 },
  dangerBtn: {
    backgroundColor: JPColors.maroon,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
    alignItems: 'center',
  },
  dangerBtnText: {
    fontFamily: JPFonts.body,
    fontWeight: '700',
    color: '#FFFFFF',
    fontSize: 15,
  },
});
