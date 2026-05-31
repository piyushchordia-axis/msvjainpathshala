/**
 * Shared centres-list surface used by the city-admin and sanchalak "centres"
 * tabs. Lists centres in the caller's scope (GET /v1/centres — scoped by JWT)
 * and, for each, shows location + status. Tapping a centre expands its batch
 * list (GET /v1/centres/:id/batches).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { centresApi, type BatchDto, type CentreDto } from '@/api/endpoints/centres';
import { DataScreen, Panel } from '@/components/admin/AdminScreen';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

const DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function StatusPill({ status }: { status: string }) {
  const active = status === 'active';
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: active ? JPColors.successBg : JPColors.creamDark,
          borderColor: active ? JPColors.success : JPColors.border,
        },
      ]}
    >
      <Text style={[styles.pillText, { color: active ? JPColors.success : JPColors.textSub }]}>
        {active ? 'Active' : 'Inactive'}
      </Text>
    </View>
  );
}

function CentreCard({ centre }: { centre: CentreDto }) {
  const [expanded, setExpanded] = React.useState(false);
  const [batches, setBatches] = React.useState<BatchDto[] | null>(null);
  const [loadingBatches, setLoadingBatches] = React.useState(false);
  const [batchError, setBatchError] = React.useState<string | null>(null);

  const toggle = React.useCallback(async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && batches === null && !loadingBatches) {
      setLoadingBatches(true);
      setBatchError(null);
      try {
        const res = await centresApi.batches(centre.id);
        setBatches(res.items);
      } catch (err) {
        setBatchError(err instanceof ApiError ? err.message : 'Could not load batches.');
      } finally {
        setLoadingBatches(false);
      }
    }
  }, [expanded, batches, loadingBatches, centre.id]);

  const locality = [centre.locality, centre.pincode].filter(Boolean).join(' · ');

  return (
    <Panel>
      <Pressable onPress={toggle}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name}>{centre.name}</Text>
            {locality ? <Text style={styles.sub}>{locality}</Text> : null}
            {centre.address_line ? (
              <Text style={styles.sub} numberOfLines={1}>
                {centre.address_line}
              </Text>
            ) : null}
          </View>
          <StatusPill status={centre.status} />
        </View>
        <Text style={styles.expandHint}>{expanded ? 'Hide batches' : 'Show batches'}</Text>
      </Pressable>

      {expanded ? (
        loadingBatches ? (
          <Text style={styles.sub}>Loading batches…</Text>
        ) : batchError ? (
          <Text style={styles.errText}>{batchError}</Text>
        ) : batches && batches.length > 0 ? (
          batches.map((b) => (
            <View key={b.id} style={styles.batchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.batchName}>{b.name}</Text>
                <Text style={styles.sub}>
                  {b.age_group} · {b.day_of_week.map((d) => DAY_LABELS[d] ?? d).join(', ')}{' '}
                  {b.start_time?.slice(0, 5)}
                </Text>
              </View>
              <Text style={styles.batchCap}>cap {b.capacity}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.sub}>No active batches in this centre.</Text>
        )
      ) : null}
    </Panel>
  );
}

export function CentresList({ title, subtitle }: { title: string; subtitle: string }) {
  const [items, setItems] = React.useState<CentreDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const res = await centresApi.list();
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load centres.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <DataScreen
      title={title}
      subtitle={subtitle}
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
      empty={items.length === 0}
      emptyTitle="No centres yet"
      emptyBody="No centres are assigned to your scope yet."
    >
      {items.map((c) => (
        <CentreCard key={c.id} centre={c} />
      ))}
    </DataScreen>
  );
}

const styles = StyleSheet.create({
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: JPSpacing.sp3 },
  name: { fontFamily: JPFonts.display, fontSize: 18, color: JPColors.maroon },
  sub: { fontFamily: JPFonts.body, fontSize: 12, color: JPColors.textSub, marginTop: 1 },
  expandHint: {
    fontFamily: JPFonts.body,
    fontSize: 12,
    color: JPColors.saffron,
    fontWeight: '600',
    marginTop: JPSpacing.sp2,
  },
  pill: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: JPRadius.pill,
  },
  pillText: { fontFamily: JPFonts.body, fontSize: 11, fontWeight: '600' },
  batchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: JPSpacing.sp2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: JPColors.divider,
  },
  batchName: {
    fontFamily: JPFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: JPColors.textPrimary,
  },
  batchCap: { fontFamily: JPFonts.body, fontSize: 12, color: JPColors.textSub },
  errText: { fontFamily: JPFonts.body, fontSize: 13, color: JPColors.error },
});
