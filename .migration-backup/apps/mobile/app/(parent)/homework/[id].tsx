/**
 * Parent homework detail screen — matches
 * jp-design-system/preview/homework-card.html.
 *
 *   - Title + due date hero
 *   - Description scrollable
 *   - Status chip (pending / late / approved / starred)
 *   - "Mark as done" CTA in saffron when status is still actionable
 *
 * Colours are token-only.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import {
  homeworkApi,
  type HomeworkForStudentRow,
  type HomeworkStatus,
} from '@/api/endpoints/homework';
import { studentsApi, type StudentDto } from '@/api/endpoints/students';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

interface State {
  loading: boolean;
  error: string | null;
  rows: HomeworkForStudentRow[];
  active: HomeworkForStudentRow | null;
  child: StudentDto | null;
  submitting: boolean;
}

const INITIAL: State = {
  loading: true,
  error: null,
  rows: [],
  active: null,
  child: null,
  submitting: false,
};

export default function HomeworkDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>(INITIAL);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const kids = await studentsApi.myChildren();
      const child = kids.items.find((s) => s.status === 'active');
      if (!child) {
        setState({ ...INITIAL, loading: false });
        return;
      }
      const res = await homeworkApi.listForStudent(child.id);
      const active = res.items.find((r) => r.assignment.id === params.id) ?? null;
      setState({
        loading: false,
        error: active ? null : 'Homework not found',
        rows: res.items,
        active,
        child,
        submitting: false,
      });
    } catch (err) {
      setState({
        ...INITIAL,
        loading: false,
        error: err instanceof ApiError ? err.message : 'Could not load homework',
      });
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const markDone = useCallback(async () => {
    if (!state.active || !state.child) return;
    setState((prev) => ({ ...prev, submitting: true }));
    try {
      await homeworkApi.markDone(state.active.assignment.id, {
        student_id: state.child.id,
      });
      await load();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        submitting: false,
        error: err instanceof ApiError ? err.message : 'Could not mark as done',
      }));
    }
  }, [state.active, state.child, load]);

  if (state.loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={JPColors.saffron} />
      </View>
    );
  }
  if (!state.active) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{state.error ?? 'Homework not found'}</Text>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const { assignment, submission } = state.active;
  const status = submission.status as HomeworkStatus;
  const canMarkDone = status === 'pending' || status === 'late';

  return (
    <ScrollView
      style={[styles.screen, { paddingTop: insets.top }]}
      contentContainerStyle={styles.scroll}
    >
      <View style={styles.headerCard}>
        <View style={styles.dueRow}>
          <Text style={styles.dueLabel}>Due</Text>
          <Text style={styles.dueValue}>{assignment.due_date}</Text>
        </View>
        <Text style={styles.title}>{assignment.title}</Text>
        <View style={statusChipStyle(status).chip}>
          <Text style={statusChipStyle(status).text}>{statusLabel(status)}</Text>
        </View>
      </View>

      {assignment.description ? (
        <View style={styles.descCard}>
          <Text style={styles.descLabel}>Instructions</Text>
          <Text style={styles.descBody}>{assignment.description}</Text>
        </View>
      ) : null}

      {submission.feedback_note ? (
        <View style={styles.feedbackCard}>
          <Text style={styles.feedbackLabel}>Feedback from Guruji</Text>
          <Text style={styles.feedbackBody}>{submission.feedback_note}</Text>
        </View>
      ) : null}

      {canMarkDone ? (
        <Pressable
          onPress={markDone}
          disabled={state.submitting}
          style={[styles.ctaButton, state.submitting && styles.ctaButtonDisabled]}
        >
          <Text style={styles.ctaText}>{state.submitting ? 'Submitting…' : 'Mark as done'}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function statusLabel(status: HomeworkStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'late':
      return 'Late';
    case 'approved':
      return 'Approved';
    case 'starred':
      return 'Starred ★';
  }
}

function statusChipStyle(status: HomeworkStatus) {
  const palette: Record<HomeworkStatus, { bg: string; text: string }> = {
    pending: { bg: JPColors.warningBg, text: JPColors.warning },
    late: { bg: JPColors.errorBg, text: JPColors.error },
    approved: { bg: JPColors.successBg, text: JPColors.success },
    starred: { bg: JPColors.gold50, text: JPColors.gold },
  };
  const p = palette[status];
  return StyleSheet.create({
    chip: {
      alignSelf: 'flex-start',
      backgroundColor: p.bg,
      paddingHorizontal: JPSpacing.sp3,
      paddingVertical: 4,
      borderRadius: JPRadius.sm,
    },
    text: {
      color: p.text,
      fontFamily: JPFonts.body,
      fontSize: 12,
      fontWeight: '700',
    },
  });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: JPColors.cream },
  scroll: { padding: JPSpacing.sp4, gap: JPSpacing.sp4 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: JPColors.cream,
    padding: JPSpacing.sp4,
  },
  errorText: {
    color: JPColors.error,
    fontFamily: JPFonts.body,
    fontSize: 14,
    marginBottom: JPSpacing.sp4,
    textAlign: 'center',
  },
  backButton: {
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: JPSpacing.sp2,
    backgroundColor: JPColors.saffron,
    borderRadius: JPRadius.md,
  },
  backText: { color: '#FFFFFF', fontFamily: JPFonts.body, fontWeight: '600' },
  headerCard: {
    backgroundColor: JPColors.creamDark,
    padding: JPSpacing.sp4,
    borderRadius: JPRadius.lg,
    gap: JPSpacing.sp3,
  },
  dueRow: { flexDirection: 'row', gap: JPSpacing.sp2, alignItems: 'center' },
  dueLabel: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 12 },
  dueValue: {
    color: JPColors.maroon,
    fontFamily: JPFonts.body,
    fontSize: 14,
    fontWeight: '700',
  },
  title: { color: JPColors.textPrimary, fontFamily: JPFonts.display, fontSize: 22 },
  descCard: {
    backgroundColor: JPColors.cream,
    borderColor: JPColors.border,
    borderWidth: 1,
    padding: JPSpacing.sp4,
    borderRadius: JPRadius.lg,
    gap: JPSpacing.sp2,
  },
  descLabel: {
    color: JPColors.textSub,
    fontFamily: JPFonts.body,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  descBody: { color: JPColors.textPrimary, fontFamily: JPFonts.body, fontSize: 15, lineHeight: 22 },
  feedbackCard: {
    backgroundColor: JPColors.successBg,
    padding: JPSpacing.sp4,
    borderRadius: JPRadius.lg,
    gap: JPSpacing.sp2,
  },
  feedbackLabel: {
    color: JPColors.success,
    fontFamily: JPFonts.body,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  feedbackBody: { color: JPColors.textPrimary, fontFamily: JPFonts.body, fontSize: 15 },
  ctaButton: {
    backgroundColor: JPColors.saffron,
    paddingVertical: JPSpacing.sp4,
    borderRadius: JPRadius.md,
    alignItems: 'center',
  },
  ctaButtonDisabled: { opacity: 0.6 },
  ctaText: { color: '#FFFFFF', fontFamily: JPFonts.body, fontSize: 16, fontWeight: '700' },
});
