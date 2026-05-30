/**
 * Parent → Donations (SPEC §6.21). Read-only surface: the donor's own
 * giving history (GET /v1/donations/me) and active public campaigns
 * (GET /v1/donations/campaigns). Receipts / 80G certificates are flagged
 * when the backend has generated them.
 *
 * Live Razorpay checkout is deliberately out of scope (native SDK); this
 * screen is the history + campaigns view.
 */

import { Stack, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import {
  donationsApi,
  type DonationCampaignRow,
  type DonationRow,
  type DonationStatus,
} from '@/api/endpoints/donations';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

const STATUS_META: Record<DonationStatus, { label: string; bg: string; fg: string }> = {
  created: { label: 'Pending', bg: JPColors.warningBg, fg: JPColors.warning },
  captured: { label: 'Received', bg: JPColors.successBg, fg: JPColors.success },
  failed: { label: 'Failed', bg: JPColors.errorBg, fg: JPColors.error },
  refunded: { label: 'Refunded', bg: JPColors.creamDeeper, fg: JPColors.textSub },
};

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function DonationsScreen() {
  const insets = useSafeAreaInsets();
  const [donations, setDonations] = useState<DonationRow[]>([]);
  const [campaigns, setCampaigns] = useState<DonationCampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mine, camps] = await Promise.all([
        donationsApi.listMine().catch(() => ({ items: [] as DonationRow[] })),
        donationsApi.listCampaigns(20).catch(() => ({ items: [] as DonationCampaignRow[] })),
      ]);
      setDonations(mine.items);
      setCampaigns(camps.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load donations');
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
      <Stack.Screen options={{ title: 'Donations' }} />
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
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {campaigns.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Active campaigns</Text>
              {campaigns.map((c) => {
                const pct =
                  c.progress_bar_visible && c.target_amount_paise && c.target_amount_paise > 0
                    ? Math.min(1, c.raised_amount_paise / c.target_amount_paise)
                    : null;
                return (
                  <View key={c.id} style={styles.card}>
                    <Text style={styles.campaignName}>{c.name}</Text>
                    {c.description ? (
                      <Text style={styles.campaignDesc} numberOfLines={3}>
                        {c.description}
                      </Text>
                    ) : null}
                    {pct !== null ? (
                      <>
                        <View style={styles.progressTrack}>
                          <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
                        </View>
                        <Text style={styles.progressLabel}>
                          {rupees(c.raised_amount_paise)} raised
                          {c.target_amount_paise ? ` of ${rupees(c.target_amount_paise)}` : ''}
                        </Text>
                      </>
                    ) : null}
                  </View>
                );
              })}
            </>
          ) : null}

          <Text style={styles.sectionTitle}>Your donations</Text>
          {donations.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.subtle}>
                You haven't made any donations yet. When you do, your receipts and 80G certificates
                will appear here.
              </Text>
            </View>
          ) : (
            donations.map((d) => {
              const meta = STATUS_META[d.status];
              return (
                <View key={d.id} style={styles.card}>
                  <View style={styles.rowTop}>
                    <Text style={styles.amount}>{rupees(d.amount_paise)}</Text>
                    <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                      <Text style={[styles.badgeText, { color: meta.fg }]}>{meta.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.purpose}>
                    {d.purpose.charAt(0).toUpperCase() + d.purpose.slice(1)}
                    {d.frequency === 'recurring' ? ' · Recurring' : ''}
                  </Text>
                  <Text style={styles.donMeta}>{fmtDate(d.created_at)}</Text>
                  {d.status === 'captured' ? (
                    <View style={styles.docRow}>
                      {d.receipt_asset_id ? <Text style={styles.docTag}>Receipt ready</Text> : null}
                      {d.eighty_g_certificate_asset_id ? (
                        <Text style={[styles.docTag, styles.docTagGold]}>80G certificate</Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: JPSpacing.sp3 },
  body: { padding: JPSpacing.sp4, gap: JPSpacing.sp3 },
  sectionTitle: {
    color: JPColors.textPrimary,
    fontFamily: JPFonts.display,
    fontSize: 18,
    marginTop: JPSpacing.sp2,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: JPColors.border,
    borderWidth: 1,
    borderRadius: JPRadius.lg,
    padding: JPSpacing.sp4,
    gap: JPSpacing.sp2,
  },
  campaignName: {
    color: JPColors.textPrimary,
    fontFamily: JPFonts.body,
    fontWeight: '700',
    fontSize: 15,
  },
  campaignDesc: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 13, lineHeight: 19 },
  progressTrack: {
    height: 8,
    backgroundColor: JPColors.creamDeeper,
    borderRadius: JPRadius.sm,
    overflow: 'hidden',
    marginTop: JPSpacing.sp2,
  },
  progressFill: { height: '100%', backgroundColor: JPColors.saffron },
  progressLabel: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 12 },
  subtle: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 13, lineHeight: 20 },
  errorText: { color: JPColors.error, fontFamily: JPFonts.body, fontSize: 14 },
  retryBtn: {
    backgroundColor: JPColors.saffron,
    paddingVertical: JPSpacing.sp2,
    paddingHorizontal: JPSpacing.sp4,
    borderRadius: JPRadius.md,
  },
  retryText: { color: '#FFFFFF', fontFamily: JPFonts.body, fontWeight: '700' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amount: { color: JPColors.textPrimary, fontFamily: JPFonts.display, fontSize: 20 },
  badge: { paddingHorizontal: JPSpacing.sp2, paddingVertical: 2, borderRadius: JPRadius.sm },
  badgeText: { fontFamily: JPFonts.body, fontSize: 11, fontWeight: '700' },
  purpose: { color: JPColors.textPrimary, fontFamily: JPFonts.body, fontSize: 13 },
  donMeta: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 11 },
  docRow: { flexDirection: 'row', flexWrap: 'wrap', gap: JPSpacing.sp2, marginTop: JPSpacing.sp1 },
  docTag: {
    backgroundColor: JPColors.successBg,
    color: JPColors.success,
    fontFamily: JPFonts.body,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: JPSpacing.sp2,
    paddingVertical: 2,
    borderRadius: JPRadius.sm,
    overflow: 'hidden',
  },
  docTagGold: { backgroundColor: JPColors.gold50, color: JPColors.gold },
});
