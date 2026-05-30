/**
 * Parent → Help & support — list of the parent's own service requests
 * (SPEC §6.19). Reads GET /v1/service-requests.
 */

import { Stack, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import {
  serviceRequestsApi,
  type ServiceRequestRow,
  type ServiceRequestStatus,
} from '@/api/endpoints/service-requests';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

const STATUS_META: Record<ServiceRequestStatus, { label: string; bg: string; fg: string }> = {
  submitted: { label: 'Submitted', bg: JPColors.creamDeeper, fg: JPColors.textSub },
  in_review: { label: 'In review', bg: JPColors.warningBg, fg: JPColors.warning },
  resolved: { label: 'Resolved', bg: JPColors.successBg, fg: JPColors.success },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ServiceRequestsListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<ServiceRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await serviceRequestsApi.listMine({ limit: 100 });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'Help & support' }} />
      <View style={styles.headerRow}>
        <Text style={styles.title}>Help & support</Text>
        <Pressable
          style={styles.newBtn}
          onPress={() => router.push('/service-requests/new' as never)}
        >
          <Text style={styles.newBtnText}>New request</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={JPColors.saffron} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void load()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.subtle}>You haven't raised any requests yet.</Text>
          <Pressable
            onPress={() => router.push('/service-requests/new' as never)}
            style={styles.retryBtn}
          >
            <Text style={styles.retryText}>Raise a request</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {items.map((it) => {
            const meta = STATUS_META[it.status];
            return (
              <Pressable
                key={it.id}
                style={styles.card}
                onPress={() => router.push(`/service-requests/${it.id}` as never)}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.category}>{it.category}</Text>
                  <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                    <Text style={[styles.badgeText, { color: meta.fg }]}>{meta.label}</Text>
                  </View>
                </View>
                <Text style={styles.desc} numberOfLines={2}>
                  {it.description}
                </Text>
                <Text style={styles.meta}>Raised {fmtDate(it.created_at)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: JPSpacing.sp3,
  },
  title: { color: JPColors.textPrimary, fontFamily: JPFonts.display, fontSize: 22 },
  newBtn: {
    backgroundColor: JPColors.saffron,
    paddingVertical: JPSpacing.sp2,
    paddingHorizontal: JPSpacing.sp3,
    borderRadius: JPRadius.pill,
  },
  newBtnText: { color: '#FFFFFF', fontFamily: JPFonts.body, fontWeight: '700', fontSize: 13 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: JPSpacing.sp3 },
  subtle: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 14 },
  errorText: { color: JPColors.error, fontFamily: JPFonts.body, fontSize: 14 },
  retryBtn: {
    backgroundColor: JPColors.saffron,
    paddingVertical: JPSpacing.sp2,
    paddingHorizontal: JPSpacing.sp4,
    borderRadius: JPRadius.md,
  },
  retryText: { color: '#FFFFFF', fontFamily: JPFonts.body, fontWeight: '700' },
  list: { padding: JPSpacing.sp4, gap: JPSpacing.sp3 },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: JPColors.border,
    borderWidth: 1,
    borderRadius: JPRadius.lg,
    padding: JPSpacing.sp4,
    gap: JPSpacing.sp2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  category: {
    color: JPColors.textPrimary,
    fontFamily: JPFonts.body,
    fontWeight: '700',
    fontSize: 15,
  },
  badge: { paddingHorizontal: JPSpacing.sp2, paddingVertical: 2, borderRadius: JPRadius.sm },
  badgeText: { fontFamily: JPFonts.body, fontSize: 11, fontWeight: '700' },
  desc: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 13, lineHeight: 19 },
  meta: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 11 },
});
