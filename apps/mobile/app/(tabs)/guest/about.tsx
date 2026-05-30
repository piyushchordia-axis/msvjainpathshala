/**
 * Guest → about. A public, unauthenticated informational screen about the MSV
 * network with live reach stats derived from the public geography directory
 * (GET /v1/geography/states + cities). No auth required.
 */

import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { geographyApi } from '@/api/endpoints/geography';
import {
  DataScreen,
  Panel,
  SectionTitle,
  StatCard,
  StatGrid,
} from '@/components/admin/AdminScreen';
import { JPColors, JPFonts } from '@/constants/colors';

interface Reach {
  states: number;
  cities: number;
}

const VALUES: Array<{ title: string; body: string }> = [
  {
    title: 'Ahimsa in learning',
    body: 'A warm, non-judgemental space where every child learns at their own pace.',
  },
  {
    title: 'Punya, not pressure',
    body: 'Progress is celebrated through Punya and spiritual tiers — never ranked against others.',
  },
  {
    title: 'Rooted in tradition',
    body: 'Bilingual lessons honour Jain values while staying easy for modern families.',
  },
];

export default function GuestAbout() {
  const router = useRouter();
  const [reach, setReach] = useState<Reach | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const statesRes = await geographyApi.states();
      const cityCounts = await Promise.all(
        statesRes.items.map((s) =>
          geographyApi
            .cities(s.id)
            .then((r) => r.items.length)
            .catch(() => 0),
        ),
      );
      setReach({
        states: statesRes.items.length,
        cities: cityCounts.reduce((a, n) => a + n, 0),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load network information.');
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
      title="About"
      subtitle="Megh Sanskar Vatika network"
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
    >
      <Panel>
        <SectionTitle>Jain Pathshala</SectionTitle>
        <Text style={styles.body}>
          Jain Pathshala is the learning platform of the Megh Sanskar Vatika network — a community
          of Pathshalas teaching Jain values, scripture and practice to children across India.
        </Text>
      </Panel>

      {reach ? (
        <StatGrid>
          <StatCard label="States" value={reach.states} accent={JPColors.saffron} />
          <StatCard label="Cities reached" value={reach.cities} accent={JPColors.gold} />
        </StatGrid>
      ) : null}

      <Panel>
        <SectionTitle>What we stand for</SectionTitle>
        {VALUES.map((v) => (
          <View key={v.title} style={styles.value}>
            <Text style={styles.valueTitle}>{v.title}</Text>
            <Text style={styles.body}>{v.body}</Text>
          </View>
        ))}
      </Panel>

      <Panel>
        <SectionTitle>Get involved</SectionTitle>
        <Text style={styles.body}>
          Parents can enrol a child, track attendance and niyams, and follow their Punya journey.
        </Text>
        <Pressable onPress={() => router.push('/(auth)/phone' as never)} style={styles.cta}>
          <Text style={styles.ctaText}>Sign in or enrol →</Text>
        </Pressable>
      </Panel>
    </DataScreen>
  );
}

const styles = StyleSheet.create({
  body: { fontFamily: JPFonts.body, fontSize: 14, color: JPColors.textPrimary, lineHeight: 21 },
  value: { gap: 2, paddingTop: 6 },
  valueTitle: { fontFamily: JPFonts.body, fontSize: 14, fontWeight: '700', color: JPColors.maroon },
  cta: { alignSelf: 'flex-start' },
  ctaText: { fontFamily: JPFonts.body, fontSize: 14, fontWeight: '700', color: JPColors.saffron },
});
