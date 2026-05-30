/**
 * Shikshak → niyams. The active niyam catalogue across the teacher's scope
 * (GET /v1/admin/niyams, city-scoped server-side). Shows each niyam's type,
 * Punya value, proof requirement and active window.
 */

import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { niyamsApi, type NiyamAdminRow } from '@/api/endpoints/niyams';
import { DataScreen, Panel } from '@/components/admin/AdminScreen';
import { PunyaBadge } from '@/components/ui';
import { JPColors, JPFonts, JPRadius } from '@/constants/colors';
import { useLanguage } from '@/features/language/use-language';

function TypePill({ type }: { type: NiyamAdminRow['type'] }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{type}</Text>
    </View>
  );
}

export default function ShikshakNiyams() {
  const lang = useLanguage();
  const router = useRouter();
  const [items, setItems] = useState<NiyamAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await niyamsApi.listForAdmin({ limit: 50 });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load niyams.');
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
      title="Niyams"
      subtitle="Active niyams across your batches"
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
      emptyTitle="No niyams yet"
      emptyBody="No niyams have been created in your scope yet."
    >
      <Pressable onPress={() => router.push('/shikshak/niyam-submissions' as never)}>
        <Panel style={styles.reviewLink}>
          <Text style={styles.reviewText}>Review submissions →</Text>
        </Panel>
      </Pressable>
      {items.map((n) => {
        const title = lang === 'hi' && n.title_hi ? n.title_hi : n.title_en;
        return (
          <Panel key={n.id}>
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <View style={styles.pillRow}>
                  <TypePill type={n.type} />
                  {n.msv_only ? (
                    <View style={[styles.pill, { backgroundColor: JPColors.gold50 }]}>
                      <Text style={[styles.pillText, { color: JPColors.gold }]}>MSV</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.title}>{title}</Text>
              </View>
              <PunyaBadge value={`+${n.points_value}`} />
            </View>
            <Text style={styles.meta}>
              Proof: {n.proof_type === 'either' ? 'photo or video' : n.proof_type} · from{' '}
              {n.start_date}
              {n.end_date ? ` to ${n.end_date}` : ''}
            </Text>
          </Panel>
        );
      })}
    </DataScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  pillRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  title: { fontFamily: JPFonts.body, fontSize: 15, fontWeight: '600', color: JPColors.textPrimary },
  meta: { fontFamily: JPFonts.body, fontSize: 12, color: JPColors.textSub },
  pill: {
    backgroundColor: JPColors.saffron50,
    borderRadius: JPRadius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  pillText: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: JPColors.saffron,
    textTransform: 'uppercase',
  },
  reviewLink: { backgroundColor: JPColors.saffron50, borderColor: JPColors.saffron },
  reviewText: {
    fontFamily: JPFonts.body,
    fontWeight: '700',
    color: JPColors.saffron,
    fontSize: 14,
  },
});
