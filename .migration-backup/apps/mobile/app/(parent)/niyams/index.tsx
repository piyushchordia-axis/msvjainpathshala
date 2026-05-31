/**
 * Parent / student-view → Niyams screen.
 *
 * Matches `jp-design-system/ui_kits/mobile/screens.jsx` "This week's Niyam"
 * card pattern, expanded into a full screen:
 *
 *   1. Child selector at top (when the parent has > 1 child).
 *   2. "Today's Niyams" — daily niyams not yet submitted today (Punya CTA).
 *   3. "Active Niyams" — every active niyam not in the today bucket
 *      (weekly / monthly / already submitted today).
 *   4. "Streaks" — per-niyam badge row, current vs longest.
 *
 * Tap a card → push /niyams/[id]/submit which uploads proof + auto-approves.
 *
 * Colours: NEVER hardcode — `JPColors.*` only.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { niyamsApi, type NiyamForCaller, type NiyamStreakDto } from '@/api/endpoints/niyams';
import { studentsApi, type StudentDto } from '@/api/endpoints/students';
import { Card, ChildSelector, EmptyState, PunyaBadge } from '@/components/ui';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

interface State {
  loading: boolean;
  error: string | null;
  children: StudentDto[];
  activeStudentId: string | null;
  niyams: NiyamForCaller[];
  streaks: NiyamStreakDto[];
  refreshing: boolean;
}

const INITIAL: State = {
  loading: true,
  error: null,
  children: [],
  activeStudentId: null,
  niyams: [],
  streaks: [],
  refreshing: false,
};

export default function NiyamsIndexScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [state, setState] = useState<State>(INITIAL);

  const loadChildren = useCallback(async () => {
    try {
      const res = await studentsApi.myChildren();
      const active = res.items.filter((s) => s.status === 'active');
      setState((prev) => ({
        ...prev,
        children: active,
        activeStudentId: prev.activeStudentId ?? active[0]?.id ?? null,
        loading: prev.activeStudentId ? prev.loading : !active[0],
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof ApiError ? err.message : 'Could not load children',
      }));
    }
  }, []);

  const loadForStudent = useCallback(async (studentId: string) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [niyamsRes, streaksRes] = await Promise.all([
        niyamsApi.listForCaller(studentId),
        niyamsApi.streaksForStudent(studentId),
      ]);
      setState((prev) => ({
        ...prev,
        loading: false,
        niyams: niyamsRes.items,
        streaks: streaksRes.items,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof ApiError ? err.message : 'Could not load niyams',
      }));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        await loadChildren();
        if (cancelled) return;
      })();
      return () => {
        cancelled = true;
      };
    }, [loadChildren]),
  );

  useEffect(() => {
    if (state.activeStudentId) void loadForStudent(state.activeStudentId);
  }, [state.activeStudentId, loadForStudent]);

  const onRefresh = useCallback(async () => {
    if (!state.activeStudentId) return;
    setState((prev) => ({ ...prev, refreshing: true }));
    await loadForStudent(state.activeStudentId);
    setState((prev) => ({ ...prev, refreshing: false }));
  }, [state.activeStudentId, loadForStudent]);

  if (state.loading && state.niyams.length === 0) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={JPColors.saffron} />
      </View>
    );
  }

  if (state.children.length === 0) {
    return (
      <View style={styles.centred}>
        <EmptyState title="No active children" body="Add a child to start tracking niyams." />
      </View>
    );
  }

  const today = state.niyams.filter((n) => n.type === 'daily' && !n.submitted_for_current_period);
  const active = state.niyams.filter(
    (n) => !(n.type === 'daily' && !n.submitted_for_current_period),
  );

  const activeChildName =
    state.children.find((c) => c.id === state.activeStudentId)?.full_name ?? '';

  return (
    <ScrollView
      contentContainerStyle={{
        padding: JPSpacing.sp4,
        paddingBottom: insets.bottom + JPSpacing.sp8,
      }}
      style={{ backgroundColor: JPColors.cream }}
      refreshControl={
        <RefreshControl
          refreshing={state.refreshing}
          onRefresh={onRefresh}
          tintColor={JPColors.saffron}
        />
      }
    >
      {state.children.length > 1 ? (
        <View style={{ marginBottom: JPSpacing.sp4 }}>
          <ChildSelector
            children={state.children.map((c) => ({
              id: c.id,
              name: c.full_name,
              initials: c.full_name
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase() ?? '')
                .join(''),
            }))}
            active={state.activeStudentId ?? state.children[0]!.id}
            onChange={(id) =>
              setState((prev) => ({ ...prev, activeStudentId: id, niyams: [], streaks: [] }))
            }
          />
        </View>
      ) : null}

      {state.error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{state.error}</Text>
        </View>
      ) : null}

      {/* Streaks row */}
      {state.streaks.length > 0 ? (
        <View style={{ marginBottom: JPSpacing.sp4 }}>
          <Text style={styles.sectionHeader}>Streaks</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {state.streaks.map((s) => (
              <View key={s.niyam_id} style={styles.streakBadge}>
                <Text style={styles.streakCurrent}>{s.current_streak}</Text>
                <Text style={styles.streakLabel}>day{s.current_streak === 1 ? '' : 's'}</Text>
                <Text style={styles.streakTitle} numberOfLines={2}>
                  {s.niyam_title_en}
                </Text>
                {s.badge_kind ? (
                  <View style={styles.streakBadgeTag}>
                    <Text style={styles.streakBadgeTagText}>{s.badge_kind}</Text>
                  </View>
                ) : null}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Today's Niyams */}
      <Text style={styles.sectionHeader}>Today's Niyams</Text>
      {today.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>All caught up</Text>
          <Text style={styles.emptySubtitle}>
            No daily niyams pending today
            {activeChildName ? ` for ${activeChildName.split(' ')[0]}` : ''}.
          </Text>
        </Card>
      ) : (
        today.map((n) => (
          <NiyamCard
            key={n.id}
            niyam={n}
            onPress={() =>
              router.push({
                pathname: '/(parent)/niyams/[id]/submit',
                params: { id: n.id, student_id: state.activeStudentId ?? '' },
              })
            }
          />
        ))
      )}

      {/* Active Niyams */}
      {active.length > 0 ? (
        <>
          <Text style={[styles.sectionHeader, { marginTop: JPSpacing.sp5 }]}>Active Niyams</Text>
          {active.map((n) => (
            <NiyamCard
              key={n.id}
              niyam={n}
              dimmed={n.submitted_for_current_period}
              onPress={
                n.submitted_for_current_period
                  ? undefined
                  : () =>
                      router.push({
                        pathname: '/(parent)/niyams/[id]/submit',
                        params: { id: n.id, student_id: state.activeStudentId ?? '' },
                      })
              }
            />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

interface NiyamCardProps {
  niyam: NiyamForCaller;
  onPress?: () => void;
  dimmed?: boolean;
}

function NiyamCard({ niyam, onPress, dimmed = false }: NiyamCardProps) {
  const typeLabel =
    niyam.type === 'daily' ? 'Today' : niyam.type === 'weekly' ? 'This week' : 'This month';
  const content = (
    <Card style={{ marginBottom: JPSpacing.sp3, opacity: dimmed ? 0.6 : 1 }}>
      <View style={styles.niyamHeader}>
        <View style={{ flex: 1, marginRight: JPSpacing.sp3 }}>
          <Text style={styles.niyamEyebrow}>NIYAM · {typeLabel.toUpperCase()}</Text>
          <Text style={styles.niyamTitle} numberOfLines={2}>
            {niyam.title_en}
          </Text>
          {niyam.title_hi ? (
            <Text style={styles.niyamTitleHi} numberOfLines={1}>
              {niyam.title_hi}
            </Text>
          ) : null}
        </View>
        <PunyaBadge value={`+${niyam.points_value}`} />
      </View>
      <View style={styles.niyamFooter}>
        <Text style={styles.niyamProof}>
          Proof: {niyam.proof_type === 'either' ? 'photo or video' : niyam.proof_type}
        </Text>
        {niyam.submitted_for_current_period ? (
          <View style={[styles.statusChip, { backgroundColor: JPColors.successBg }]}>
            <Text style={[styles.statusChipText, { color: JPColors.success }]}>Submitted</Text>
          </View>
        ) : (
          <View style={[styles.statusChip, { backgroundColor: JPColors.saffron50 }]}>
            <Text style={[styles.statusChipText, { color: JPColors.saffron }]}>Submit →</Text>
          </View>
        )}
      </View>
    </Card>
  );

  if (!onPress) return content;
  return <Pressable onPress={onPress}>{content}</Pressable>;
}

const styles = StyleSheet.create({
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: JPColors.cream,
  },
  errorBanner: {
    backgroundColor: JPColors.errorBg,
    padding: JPSpacing.sp3,
    borderRadius: JPRadius.md,
    marginBottom: JPSpacing.sp4,
  },
  errorText: {
    color: JPColors.error,
    fontSize: 13,
    fontFamily: JPFonts.body,
  },
  sectionHeader: {
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 15,
    color: JPColors.textPrimary,
    marginBottom: JPSpacing.sp2,
    paddingHorizontal: JPSpacing.sp1,
  },
  emptyCard: {
    padding: JPSpacing.sp4,
    alignItems: 'center',
  },
  emptyTitle: {
    fontFamily: JPFonts.display,
    color: JPColors.maroon,
    fontSize: 18,
    marginBottom: JPSpacing.sp1,
  },
  emptySubtitle: {
    color: JPColors.textSub,
    fontSize: 13,
    textAlign: 'center',
  },
  streakBadge: {
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.lg,
    paddingVertical: JPSpacing.sp3,
    paddingHorizontal: JPSpacing.sp4,
    marginRight: JPSpacing.sp3,
    borderWidth: 1,
    borderColor: JPColors.border,
    minWidth: 120,
    alignItems: 'center',
  },
  streakCurrent: {
    fontFamily: JPFonts.display,
    fontSize: 28,
    color: JPColors.saffron,
    lineHeight: 32,
  },
  streakLabel: {
    fontSize: 11,
    color: JPColors.textSub,
    marginTop: 2,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  streakTitle: {
    fontSize: 11,
    color: JPColors.textPrimary,
    marginTop: JPSpacing.sp2,
    textAlign: 'center',
    maxWidth: 140,
  },
  streakBadgeTag: {
    backgroundColor: JPColors.gold50,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    marginTop: JPSpacing.sp2,
  },
  streakBadgeTagText: {
    color: JPColors.gold,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  niyamHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  niyamEyebrow: {
    fontSize: 10,
    fontWeight: '600',
    color: JPColors.textSub,
    letterSpacing: 1.5,
  },
  niyamTitle: {
    fontFamily: JPFonts.body,
    fontWeight: '600',
    color: JPColors.textPrimary,
    fontSize: 15,
    marginTop: 4,
  },
  niyamTitleHi: {
    fontFamily: JPFonts.display,
    color: JPColors.maroon,
    fontSize: 13,
    marginTop: 2,
    lineHeight: 22,
  },
  niyamFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: JPSpacing.sp3,
  },
  niyamProof: {
    fontSize: 11,
    color: JPColors.textSub,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
