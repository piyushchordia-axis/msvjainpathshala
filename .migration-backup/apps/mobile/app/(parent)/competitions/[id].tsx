/**
 * Parent / student-view competition detail screen.
 *
 *   - Bilingual name + description hero
 *   - Event date + registration window meta
 *   - Saffron "Register" CTA when status='open' and a child is eligible
 *   - "Results published" badge after publishResults runs
 *
 * Tokens only.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import {
  competitionsApi,
  type CompetitionDto,
  type CompetitionStatus,
} from '@/api/endpoints/competitions';
import { studentsApi, type StudentDto } from '@/api/endpoints/students';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

interface State {
  loading: boolean;
  error: string | null;
  competition: CompetitionDto | null;
  child: StudentDto | null;
  registered: boolean;
  registering: boolean;
}

const INITIAL: State = {
  loading: true,
  error: null,
  competition: null,
  child: null,
  registered: false,
  registering: false,
};

export default function CompetitionDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>(INITIAL);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const kids = await studentsApi.myChildren();
      const child = kids.items.find((s) => s.status === 'active') ?? null;
      const res = await competitionsApi.listForCaller(child?.id);
      const comp = res.items.find((c) => c.id === params.id) ?? null;
      setState({
        loading: false,
        error: comp ? null : 'Competition not found',
        competition: comp,
        child,
        registered: false,
        registering: false,
      });
    } catch (err) {
      setState({
        ...INITIAL,
        loading: false,
        error: err instanceof ApiError ? err.message : 'Could not load competition',
      });
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const register = useCallback(async () => {
    if (!state.competition || !state.child) return;
    setState((prev) => ({ ...prev, registering: true }));
    try {
      await competitionsApi.register(state.competition.id, { student_id: state.child.id });
      setState((prev) => ({ ...prev, registered: true, registering: false }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        registering: false,
        error: err instanceof ApiError ? err.message : 'Could not register',
      }));
    }
  }, [state.competition, state.child]);

  if (state.loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={JPColors.saffron} />
      </View>
    );
  }
  if (!state.competition) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{state.error ?? 'Competition not found'}</Text>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>Go back</Text>
        </Pressable>
      </View>
    );
  }
  const c = state.competition;
  const canRegister = c.status === 'open' && state.child && !state.registered;

  return (
    <ScrollView
      style={[styles.screen, { paddingTop: insets.top }]}
      contentContainerStyle={styles.scroll}
    >
      <View style={styles.headerCard}>
        <Text style={styles.title}>{c.name_en}</Text>
        <Text style={styles.titleHi}>{c.name_hi}</Text>
        <View style={statusChipStyle(c.status).chip}>
          <Text style={statusChipStyle(c.status).text}>{statusLabel(c.status)}</Text>
        </View>
      </View>
      {c.description_en || c.description_hi ? (
        <View style={styles.descCard}>
          <Text style={styles.descLabel}>About</Text>
          {c.description_en ? <Text style={styles.descBody}>{c.description_en}</Text> : null}
          {c.description_hi ? <Text style={styles.descBodyHi}>{c.description_hi}</Text> : null}
        </View>
      ) : null}
      <View style={styles.metaCard}>
        {c.event_date ? <MetaRow label="Event date" value={c.event_date} /> : null}
        {c.registration_window_end ? (
          <MetaRow
            label="Registration closes"
            value={new Date(c.registration_window_end).toLocaleString()}
          />
        ) : null}
        {c.max_participants != null ? (
          <MetaRow label="Capacity" value={`Up to ${c.max_participants} participants`} />
        ) : null}
        <MetaRow
          label="Punya"
          value={`Winner +${c.winner_points}, participants +${c.participant_points}`}
        />
      </View>

      {canRegister ? (
        <Pressable
          onPress={register}
          disabled={state.registering}
          style={[styles.ctaButton, state.registering && styles.ctaButtonDisabled]}
        >
          <Text style={styles.ctaText}>
            {state.registering ? 'Registering…' : `Register ${state.child?.full_name ?? ''}`}
          </Text>
        </Pressable>
      ) : null}
      {state.registered ? (
        <View style={styles.registeredChip}>
          <Text style={styles.registeredText}>Registered ✓</Text>
        </View>
      ) : null}
      {state.error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{state.error}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function statusLabel(status: CompetitionStatus): string {
  switch (status) {
    case 'draft':
      return 'Coming soon';
    case 'open':
      return 'Open';
    case 'closed':
      return 'Closed';
    case 'results_published':
      return 'Results out';
  }
}

function statusChipStyle(status: CompetitionStatus) {
  const palette: Record<CompetitionStatus, { bg: string; text: string }> = {
    draft: { bg: JPColors.creamDeeper, text: JPColors.textSub },
    open: { bg: JPColors.successBg, text: JPColors.success },
    closed: { bg: JPColors.warningBg, text: JPColors.warning },
    results_published: { bg: JPColors.gold50, text: JPColors.gold },
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
    text: { color: p.text, fontFamily: JPFonts.body, fontSize: 12, fontWeight: '700' },
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
    gap: JPSpacing.sp2,
  },
  title: { color: JPColors.textPrimary, fontFamily: JPFonts.display, fontSize: 24 },
  titleHi: { color: JPColors.maroon, fontFamily: JPFonts.display, fontSize: 18, lineHeight: 26 },
  descCard: {
    backgroundColor: JPColors.cream,
    borderColor: JPColors.border,
    borderWidth: 1,
    padding: JPSpacing.sp4,
    borderRadius: JPRadius.lg,
    gap: JPSpacing.sp3,
  },
  descLabel: {
    color: JPColors.textSub,
    fontFamily: JPFonts.body,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  descBody: { color: JPColors.textPrimary, fontFamily: JPFonts.body, fontSize: 15, lineHeight: 22 },
  descBodyHi: {
    color: JPColors.textPrimary,
    fontFamily: JPFonts.body,
    fontSize: 15,
    lineHeight: 24,
  },
  metaCard: {
    backgroundColor: JPColors.creamDark,
    padding: JPSpacing.sp4,
    borderRadius: JPRadius.lg,
    gap: JPSpacing.sp3,
  },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metaLabel: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 13 },
  metaValue: {
    color: JPColors.textPrimary,
    fontFamily: JPFonts.body,
    fontSize: 13,
    fontWeight: '600',
  },
  ctaButton: {
    backgroundColor: JPColors.saffron,
    paddingVertical: JPSpacing.sp4,
    borderRadius: JPRadius.md,
    alignItems: 'center',
  },
  ctaButtonDisabled: { opacity: 0.6 },
  ctaText: { color: '#FFFFFF', fontFamily: JPFonts.body, fontSize: 16, fontWeight: '700' },
  registeredChip: {
    alignSelf: 'center',
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: JPSpacing.sp3,
    backgroundColor: JPColors.successBg,
    borderRadius: JPRadius.md,
  },
  registeredText: {
    color: JPColors.success,
    fontFamily: JPFonts.body,
    fontSize: 15,
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: JPColors.errorBg,
    padding: JPSpacing.sp3,
    borderRadius: JPRadius.md,
  },
});
