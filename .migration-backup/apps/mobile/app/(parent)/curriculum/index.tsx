/**
 * Parent / student-view curriculum progress screen — Step 19.
 *
 * Renders the active curriculum's sections + items as a tree, with a saffron
 * progress bar per section (completed+mastered / total) and per-item chips
 * (not_started / in_progress / completed / mastered).
 *
 * Read-only — the shikshak updates progress via the admin panel; this screen
 * just shows the parent how their child is doing.
 */

import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import {
  curriculumApi,
  type CurriculumLevel,
  type StudentProgressResponseDto,
} from '@/api/endpoints/curriculum';
import { studentsApi, type StudentDto } from '@/api/endpoints/students';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

interface State {
  loading: boolean;
  error: string | null;
  child: StudentDto | null;
  data: StudentProgressResponseDto | null;
  hasNoCurriculum: boolean;
}

const INITIAL: State = {
  loading: true,
  error: null,
  child: null,
  data: null,
  hasNoCurriculum: false,
};

export default function CurriculumScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>(INITIAL);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const kids = await studentsApi.myChildren();
      const child = kids.items.find((s) => s.status === 'active') ?? null;
      if (!child) {
        setState({ ...INITIAL, loading: false, error: 'No active student found' });
        return;
      }
      // Parents can't list curricula (admin-only). The backend resolves the
      // curriculum assigned to the child's batch and returns its progress; a
      // 404 means nothing is assigned yet.
      const data = await curriculumApi.studentProgress(child.id);
      setState({
        loading: false,
        error: null,
        child,
        data,
        hasNoCurriculum: false,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ERR_RESOURCE_NOT_FOUND') {
        setState({ ...INITIAL, loading: false, hasNoCurriculum: true });
        return;
      }
      setState({
        ...INITIAL,
        loading: false,
        error: err instanceof ApiError ? err.message : 'Could not load curriculum',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={JPColors.saffron} />
      </View>
    );
  }
  if (state.hasNoCurriculum) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.title}>No active curriculum</Text>
        <Text style={styles.subtle}>Your centre hasn't assigned a curriculum yet.</Text>
        <Pressable onPress={() => router.back()} style={styles.ctaButton}>
          <Text style={styles.ctaText}>Go back</Text>
        </Pressable>
      </View>
    );
  }
  if (!state.data) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{state.error ?? 'Curriculum not found'}</Text>
        <Pressable onPress={() => router.back()} style={styles.ctaButton}>
          <Text style={styles.ctaText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const { curriculum, sections, totals } = state.data;
  const overallProgress =
    totals.items === 0 ? 0 : (totals.completed + totals.mastered) / totals.items;

  return (
    <ScrollView
      style={[styles.screen, { paddingTop: insets.top }]}
      contentContainerStyle={styles.scroll}
    >
      <View style={styles.headerCard}>
        <Text style={styles.kindChip}>{curriculum.kind === 'msv' ? 'MSV' : 'Standard'}</Text>
        <Text style={styles.title}>{curriculum.name}</Text>
        {curriculum.academic_year ? (
          <Text style={styles.subtle}>{curriculum.academic_year}</Text>
        ) : null}
        <ProgressBar progress={overallProgress} />
        <Text style={styles.progressLabel}>
          {totals.completed + totals.mastered} of {totals.items} items completed
        </Text>
      </View>

      {sections.map((s) => {
        const sectionDone = s.items.filter(
          (i) => i.progress?.level === 'completed' || i.progress?.level === 'mastered',
        ).length;
        const sectionTotal = s.items.length;
        const sectionPct = sectionTotal === 0 ? 0 : sectionDone / sectionTotal;
        return (
          <View key={s.section.id} style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{s.section.title_en}</Text>
            <Text style={styles.sectionTitleHi}>{s.section.title_hi}</Text>
            <ProgressBar progress={sectionPct} small />
            <View style={styles.itemList}>
              {s.items.map((it) => (
                <View key={it.item.id} style={styles.item}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.itemTitle}>{it.item.title_en}</Text>
                    <Text style={styles.itemTitleHi}>{it.item.title_hi}</Text>
                  </View>
                  <LevelChip level={(it.progress?.level ?? 'not_started') as CurriculumLevel} />
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

function ProgressBar({ progress, small }: { progress: number; small?: boolean }) {
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <View style={[styles.progressTrack, small && { height: 6 }]}>
      <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
    </View>
  );
}

function LevelChip({ level }: { level: CurriculumLevel }) {
  const palette: Record<CurriculumLevel, { bg: string; fg: string; label: string }> = {
    not_started: { bg: JPColors.creamDeeper, fg: JPColors.textSub, label: 'Not started' },
    in_progress: { bg: JPColors.warningBg, fg: JPColors.warning, label: 'In progress' },
    completed: { bg: JPColors.successBg, fg: JPColors.success, label: 'Completed' },
    mastered: { bg: JPColors.gold50, fg: JPColors.gold, label: 'Mastered ★' },
  };
  const p = palette[level];
  return (
    <View
      style={{
        backgroundColor: p.bg,
        paddingHorizontal: JPSpacing.sp2,
        paddingVertical: 4,
        borderRadius: JPRadius.sm,
      }}
    >
      <Text style={{ color: p.fg, fontFamily: JPFonts.body, fontSize: 11, fontWeight: '700' }}>
        {p.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: JPColors.cream },
  scroll: { padding: JPSpacing.sp4, gap: JPSpacing.sp4 },
  centered: {
    flex: 1,
    backgroundColor: JPColors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    padding: JPSpacing.sp4,
    gap: JPSpacing.sp3,
  },
  headerCard: {
    backgroundColor: JPColors.creamDark,
    padding: JPSpacing.sp4,
    borderRadius: JPRadius.lg,
    gap: JPSpacing.sp3,
  },
  kindChip: {
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
  title: { color: JPColors.textPrimary, fontFamily: JPFonts.display, fontSize: 22 },
  subtle: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 13 },
  progressTrack: {
    height: 10,
    backgroundColor: JPColors.creamDeeper,
    borderRadius: JPRadius.sm,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: JPColors.saffron,
  },
  progressLabel: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 12 },
  sectionCard: {
    backgroundColor: JPColors.cream,
    borderColor: JPColors.border,
    borderWidth: 1,
    padding: JPSpacing.sp4,
    borderRadius: JPRadius.lg,
    gap: JPSpacing.sp3,
  },
  sectionTitle: { color: JPColors.textPrimary, fontFamily: JPFonts.display, fontSize: 17 },
  sectionTitleHi: {
    color: JPColors.maroon,
    fontFamily: JPFonts.body,
    fontSize: 14,
    lineHeight: 22,
  },
  itemList: { gap: JPSpacing.sp2 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: JPColors.creamDark,
    padding: JPSpacing.sp3,
    borderRadius: JPRadius.md,
    gap: JPSpacing.sp3,
  },
  itemTitle: { color: JPColors.textPrimary, fontFamily: JPFonts.body, fontSize: 14 },
  itemTitleHi: { color: JPColors.maroon, fontFamily: JPFonts.body, fontSize: 13, lineHeight: 22 },
  ctaButton: {
    backgroundColor: JPColors.saffron,
    paddingVertical: JPSpacing.sp3,
    paddingHorizontal: JPSpacing.sp4,
    borderRadius: JPRadius.md,
    alignItems: 'center',
  },
  ctaText: { color: '#FFFFFF', fontFamily: JPFonts.body, fontWeight: '700' },
  errorText: { color: JPColors.error, fontFamily: JPFonts.body, fontSize: 14, textAlign: 'center' },
});
