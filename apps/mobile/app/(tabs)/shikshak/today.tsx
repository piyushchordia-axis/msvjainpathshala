/**
 * Shikshak — Today's batches.
 *
 * Mirrors `jp-design-system/ui_kits/mobile/screens.jsx` "Today" layout:
 * cream background, white card per batch, saffron active states. Each card
 * surfaces the batch name, centre, scheduled window, and a primary CTA
 * (Check in / Resume / Mark / Review) based on the session status.
 *
 * Network is intentionally lazy — pull-to-refresh is supported but the
 * initial mount fetches once and shows cached data afterwards.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
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

import { Header } from '@/components/ui';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';
import { attendanceApi, type TodayRow } from '@/features/attendance/attendance.api';

export default function ShikshakTodayScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<TodayRow[]>([]);
  const [date, setDate] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await attendanceApi.today();
      setItems(res.items);
      setDate(res.date);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load today.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Header title="Today" subtitle={date ? formatDate(date) : 'Your sessions'} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading ? (
          <ActivityIndicator color={JPColors.saffron} style={styles.spinner} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No sessions scheduled today</Text>
            <Text style={styles.emptyBody}>
              Your Today list refreshes when batches assigned to you have a session for today.
            </Text>
          </View>
        ) : (
          items.map((row) => (
            <BatchCard key={row.batch_id} row={row} onPress={() => routeForBatch(router, row)} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function BatchCard({ row, onPress }: { row: TodayRow; onPress: () => void }) {
  const ctaLabel = ctaForRow(row);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.batchName}>{row.batch_name}</Text>
        <StatusPill status={row.session_status} />
      </View>
      <Text style={styles.centreName}>{row.centre_name}</Text>
      <Text style={styles.times}>
        {formatTime(row.start_time)} → {formatTime(row.end_time)}
      </Text>
      <View style={styles.cta}>
        <Text style={styles.ctaLabel}>{ctaLabel}</Text>
      </View>
    </Pressable>
  );
}

function StatusPill({ status }: { status: TodayRow['session_status'] }) {
  if (status === 'in_progress') {
    return (
      <View style={[styles.pill, { backgroundColor: JPColors.successBg }]}>
        <Text style={[styles.pillText, { color: JPColors.success }]}>In progress</Text>
      </View>
    );
  }
  if (status === 'completed') {
    return (
      <View style={[styles.pill, { backgroundColor: JPColors.cream }]}>
        <Text style={[styles.pillText, { color: JPColors.textSub }]}>Completed</Text>
      </View>
    );
  }
  if (status === 'cancelled') {
    return (
      <View style={[styles.pill, { backgroundColor: JPColors.errorBg }]}>
        <Text style={[styles.pillText, { color: JPColors.error }]}>Cancelled</Text>
      </View>
    );
  }
  return (
    <View style={[styles.pill, { backgroundColor: JPColors.saffron50 }]}>
      <Text style={[styles.pillText, { color: JPColors.saffron }]}>Scheduled</Text>
    </View>
  );
}

function ctaForRow(row: TodayRow): string {
  switch (row.session_status) {
    case 'in_progress':
      return 'Mark attendance';
    case 'completed':
      return 'Review';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Check in';
  }
}

function routeForBatch(router: ReturnType<typeof useRouter>, row: TodayRow): void {
  // Convention: dynamic routes live at app/shikshak/sessions/[id]/*.
  if (row.session_status === 'in_progress' && row.session_id) {
    router.push(`/shikshak/sessions/${row.session_id}/mark` as never);
  } else if (row.session_status === 'completed' && row.session_id) {
    router.push(`/shikshak/sessions/${row.session_id}/checkout` as never);
  } else if (row.session_status === 'cancelled') {
    // No-op — pill is enough signal.
  } else {
    // Scheduled or no session yet → check-in flow keyed off the batch id.
    router.push(`/shikshak/sessions/new/checkin?batch_id=${row.batch_id}` as never);
  }
}

function formatTime(t: string): string {
  // 'HH:MM:SS' → 'HH:MM'
  return t.slice(0, 5);
}

function formatDate(d: string): string {
  try {
    const dt = new Date(`${d}T00:00:00`);
    return dt.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  } catch {
    return d;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: JPColors.cream,
  },
  scrollContent: {
    paddingHorizontal: JPSpacing.sp4,
    paddingBottom: JPSpacing.sp6,
  },
  spinner: {
    marginTop: 48,
  },
  errorText: {
    color: JPColors.error,
    marginTop: 32,
    textAlign: 'center',
    fontFamily: JPFonts.body,
    fontWeight: '500',
  },
  emptyCard: {
    backgroundColor: JPColors.cream,
    borderColor: JPColors.creamDeeper,
    borderWidth: 1,
    borderRadius: JPRadius.lg,
    padding: JPSpacing.sp4,
    marginTop: JPSpacing.sp4,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: JPFonts.body,
    fontWeight: '700',
    color: JPColors.textPrimary,
    marginBottom: 6,
  },
  emptyBody: {
    fontSize: 14,
    color: JPColors.textSub,
    fontFamily: JPFonts.body,
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.lg,
    padding: JPSpacing.sp4,
    marginTop: JPSpacing.sp3,
    borderColor: JPColors.creamDeeper,
    borderWidth: 1,
    shadowColor: JPColors.maroon,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  batchName: {
    fontSize: 17,
    fontFamily: JPFonts.body,
    fontWeight: '700',
    color: JPColors.textPrimary,
  },
  centreName: {
    marginTop: 4,
    color: JPColors.textSub,
    fontFamily: JPFonts.body,
    fontWeight: '500',
    fontSize: 13,
  },
  times: {
    marginTop: 2,
    color: JPColors.textSub,
    fontFamily: JPFonts.body,
    fontSize: 13,
  },
  cta: {
    marginTop: JPSpacing.sp3,
    alignSelf: 'flex-start',
    backgroundColor: JPColors.saffron,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: JPRadius.md,
  },
  ctaLabel: {
    color: '#FFFFFF',
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 14,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 11,
    fontFamily: JPFonts.body,
    fontWeight: '600',
  },
});
