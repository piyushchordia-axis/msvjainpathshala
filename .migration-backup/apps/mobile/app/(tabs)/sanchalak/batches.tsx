/**
 * Sanchalak → batches. Aggregates batches across all the centres assigned to
 * this sanchalak: GET /v1/centres then GET /v1/centres/:id/batches for each.
 * Shows schedule, age group, and capacity per batch grouped by centre.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { centresApi, type BatchDto, type CentreDto } from '@/api/endpoints/centres';
import {
  DataScreen,
  Panel,
  SectionTitle,
  StatCard,
  StatGrid,
} from '@/components/admin/AdminScreen';
import { JPColors, JPFonts } from '@/constants/colors';

const DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface CentreWithBatches {
  centre: CentreDto;
  batches: BatchDto[];
}

export default function SanchalakBatches() {
  const [groups, setGroups] = useState<CentreWithBatches[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const centresRes = await centresApi.list();
      const withBatches = await Promise.all(
        centresRes.items.map(async (centre) => {
          const b = await centresApi.batches(centre.id);
          return { centre, batches: b.items };
        }),
      );
      setGroups(withBatches);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load batches.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalBatches = groups.reduce((a, g) => a + g.batches.length, 0);
  const totalCapacity = groups.reduce(
    (a, g) => a + g.batches.reduce((s, b) => s + b.capacity, 0),
    0,
  );

  return (
    <DataScreen
      title="Batches"
      subtitle="Across the centres you sanchalak"
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
      empty={totalBatches === 0}
      emptyTitle="No batches yet"
      emptyBody="No batches exist across your centres yet."
    >
      <StatGrid>
        <StatCard label="Batches" value={totalBatches} accent={JPColors.saffron} />
        <StatCard label="Total capacity" value={totalCapacity} />
      </StatGrid>

      {groups
        .filter((g) => g.batches.length > 0)
        .map((g) => (
          <Panel key={g.centre.id}>
            <SectionTitle>{g.centre.name}</SectionTitle>
            {g.batches.map((b) => (
              <View key={b.id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.batchName}>{b.name}</Text>
                  <Text style={styles.sub}>
                    {b.age_group} · {b.day_of_week.map((d) => DAY_LABELS[d] ?? d).join(', ')}{' '}
                    {b.start_time?.slice(0, 5)}–{b.end_time?.slice(0, 5)}
                  </Text>
                </View>
                <Text style={styles.cap}>cap {b.capacity}</Text>
              </View>
            ))}
          </Panel>
        ))}
    </DataScreen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: JPColors.divider,
  },
  batchName: {
    fontFamily: JPFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: JPColors.textPrimary,
  },
  sub: { fontFamily: JPFonts.body, fontSize: 12, color: JPColors.textSub, marginTop: 1 },
  cap: { fontFamily: JPFonts.body, fontSize: 12, color: JPColors.textSub },
});
