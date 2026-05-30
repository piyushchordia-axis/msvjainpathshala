/**
 * Shikshak → batches. Lists the batches in the teacher's centres
 * (GET /v1/centres then GET /v1/centres/:id/batches), highlighting the
 * batches assigned to this shikshak. Tapping a batch loads its upcoming
 * session slots from the timetable (GET /v1/batches/:id/timetable).
 */

import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { batchesApi, centresApi, type BatchDto, type TimetableSlot } from '@/api/endpoints/centres';
import { DataScreen, Panel } from '@/components/admin/AdminScreen';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';
import { useAuth } from '@/features/auth/auth-context';

const DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function BatchCard({ batch, mine }: { batch: BatchDto; mine: boolean }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [slots, setSlots] = useState<TimetableSlot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && slots === null && !loading) {
      setLoading(true);
      setError(null);
      try {
        const res = await batchesApi.timetable(batch.id, 4);
        setSlots(res.slots);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load the timetable.');
      } finally {
        setLoading(false);
      }
    }
  }, [expanded, slots, loading, batch.id]);

  return (
    <Panel>
      <Pressable onPress={toggle}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{batch.name}</Text>
            <Text style={styles.sub}>
              {batch.age_group} · {batch.day_of_week.map((d) => DAY_LABELS[d] ?? d).join(', ')}{' '}
              {batch.start_time?.slice(0, 5)}–{batch.end_time?.slice(0, 5)}
            </Text>
          </View>
          {mine ? (
            <View style={styles.minePill}>
              <Text style={styles.minePillText}>You teach</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.hint}>{expanded ? 'Hide schedule' : 'Show upcoming sessions'}</Text>
      </Pressable>
      <Pressable
        style={styles.assignBtn}
        onPress={() =>
          router.push({
            pathname: '/shikshak/homework/new',
            params: { batchId: batch.id, batchName: batch.name },
          } as never)
        }
      >
        <Text style={styles.assignBtnText}>Assign homework</Text>
      </Pressable>
      {expanded ? (
        loading ? (
          <Text style={styles.sub}>Loading schedule…</Text>
        ) : error ? (
          <Text style={styles.err}>{error}</Text>
        ) : slots && slots.length > 0 ? (
          slots.slice(0, 8).map((s, i) => (
            <View key={`${s.date}-${i}`} style={styles.slotRow}>
              <Text style={styles.slotDate}>{s.date}</Text>
              <Text style={styles.sub}>
                {s.is_holiday
                  ? `Holiday${s.holiday_name ? ` · ${s.holiday_name}` : ''}`
                  : `${s.start_time?.slice(0, 5)}–${s.end_time?.slice(0, 5)}`}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.sub}>No upcoming sessions scheduled.</Text>
        )
      ) : null}
    </Panel>
  );
}

export default function ShikshakBatches() {
  const { user } = useAuth();
  const [batches, setBatches] = useState<BatchDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const centresRes = await centresApi.list();
      const lists = await Promise.all(centresRes.items.map((c) => centresApi.batches(c.id)));
      setBatches(lists.flatMap((l) => l.items));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your batches.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Surface the teacher's own batches first.
  const sorted = [...batches].sort((a, b) => {
    const am = a.shikshak_id === user?.id ? 0 : 1;
    const bm = b.shikshak_id === user?.id ? 0 : 1;
    return am - bm;
  });

  return (
    <DataScreen
      title="Batches"
      subtitle="Batches in your centres"
      loading={loading}
      error={error}
      onRetry={() => {
        setLoading(true);
        void load();
      }}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      empty={sorted.length === 0}
      emptyTitle="No batches yet"
      emptyBody="No batches are available in your centres yet."
    >
      {sorted.map((b) => (
        <BatchCard key={b.id} batch={b} mine={b.shikshak_id === user?.id} />
      ))}
    </DataScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title: { fontFamily: JPFonts.display, fontSize: 17, color: JPColors.maroon },
  sub: { fontFamily: JPFonts.body, fontSize: 12, color: JPColors.textSub, marginTop: 1 },
  hint: {
    fontFamily: JPFonts.body,
    fontSize: 12,
    color: JPColors.saffron,
    fontWeight: '600',
    marginTop: JPSpacing.sp2,
  },
  minePill: {
    backgroundColor: JPColors.saffron50,
    borderRadius: JPRadius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  minePillText: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: JPColors.saffron,
  },
  slotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: JPColors.divider,
  },
  slotDate: { fontFamily: JPFonts.body, fontSize: 13, color: JPColors.textPrimary },
  err: { fontFamily: JPFonts.body, fontSize: 13, color: JPColors.error },
  assignBtn: {
    marginTop: JPSpacing.sp2,
    backgroundColor: JPColors.saffron50,
    borderRadius: JPRadius.md,
    paddingVertical: JPSpacing.sp2,
    alignItems: 'center',
  },
  assignBtnText: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    fontWeight: '700',
    color: JPColors.saffron,
  },
});
