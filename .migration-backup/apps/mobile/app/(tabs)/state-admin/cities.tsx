/**
 * State admin → cities. Browses the geography directory: states
 * (GET /v1/geography/states) and, for each, its cities
 * (GET /v1/geography/states/:id/cities). Tap a state to expand its cities.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { geographyApi, type CityDto, type StateDto } from '@/api/endpoints/geography';
import { DataScreen, Panel, SectionTitle } from '@/components/admin/AdminScreen';
import { JPColors, JPFonts, JPSpacing } from '@/constants/colors';

function StateCard({ state }: { state: StateDto }) {
  const [expanded, setExpanded] = useState(false);
  const [cities, setCities] = useState<CityDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && cities === null && !loading) {
      setLoading(true);
      setError(null);
      try {
        const res = await geographyApi.cities(state.id);
        setCities(res.items);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load cities.');
      } finally {
        setLoading(false);
      }
    }
  }, [expanded, cities, loading, state.id]);

  return (
    <Panel>
      <Pressable onPress={toggle}>
        <View style={styles.headerRow}>
          <SectionTitle>{state.name}</SectionTitle>
          <Text style={styles.code}>{state.code}</Text>
        </View>
        <Text style={styles.hint}>{expanded ? 'Hide cities' : 'Show cities'}</Text>
      </Pressable>
      {expanded ? (
        loading ? (
          <Text style={styles.sub}>Loading cities…</Text>
        ) : error ? (
          <Text style={styles.err}>{error}</Text>
        ) : cities && cities.length > 0 ? (
          cities.map((c) => (
            <View key={c.id} style={styles.cityRow}>
              <Text style={styles.cityName}>{c.name}</Text>
              <Text style={styles.code}>{c.code}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.sub}>No cities in this state yet.</Text>
        )
      ) : null}
    </Panel>
  );
}

export default function StateAdminCities() {
  const [items, setItems] = useState<StateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await geographyApi.states();
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the directory.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <DataScreen
      title="Cities"
      subtitle="State and city directory"
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
      emptyTitle="No states yet"
      emptyBody="The geography directory is empty."
    >
      {items.map((s) => (
        <StateCard key={s.id} state={s} />
      ))}
    </DataScreen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hint: { fontFamily: JPFonts.body, fontSize: 12, color: JPColors.saffron, fontWeight: '600' },
  code: { fontFamily: JPFonts.mono, fontSize: 12, color: JPColors.textSub },
  sub: { fontFamily: JPFonts.body, fontSize: 13, color: JPColors.textSub },
  err: { fontFamily: JPFonts.body, fontSize: 13, color: JPColors.error },
  cityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: JPSpacing.sp2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: JPColors.divider,
  },
  cityName: { fontFamily: JPFonts.body, fontSize: 14, color: JPColors.textPrimary },
});
