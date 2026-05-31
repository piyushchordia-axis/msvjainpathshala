/**
 * Student view → home. At-a-glance for the active child:
 *   - Punya balance + spiritual tier (GET /v1/students/:id/punya/balance).
 *   - Niyam streaks (GET /v1/students/:id/niyam-streaks).
 *   - Recent niyam submissions (GET /v1/students/:id/niyams/recent).
 *
 * Student view is a context within the parent's session, so the first active
 * child is used as the subject (matching the parent screens' default).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { niyamsApi, type NiyamStreakDto, type NiyamSubmissionRow } from '@/api/endpoints/niyams';
import {
  punyaApi,
  TIER_COLORS,
  TIER_LABEL,
  TIER_LABEL_HI,
  type PunyaBalanceDto,
  type Tier,
} from '@/api/endpoints/punya';
import { studentsApi, type StudentDto } from '@/api/endpoints/students';
import { DataScreen, Panel, SectionTitle } from '@/components/admin/AdminScreen';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';
import { useLanguage } from '@/features/language/use-language';

export default function StudentViewHome() {
  const lang = useLanguage();
  const [student, setStudent] = useState<StudentDto | null>(null);
  const [balance, setBalance] = useState<PunyaBalanceDto | null>(null);
  const [streaks, setStreaks] = useState<NiyamStreakDto[]>([]);
  const [recent, setRecent] = useState<NiyamSubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const childrenRes = await studentsApi.myChildren();
      const active = childrenRes.items.find((s) => s.status === 'active') ?? null;
      setStudent(active);
      if (!active) {
        setBalance(null);
        setStreaks([]);
        setRecent([]);
        return;
      }
      const [b, st, rec] = await Promise.all([
        punyaApi.balance(active.id),
        niyamsApi.streaksForStudent(active.id).catch(() => ({ items: [] as NiyamStreakDto[] })),
        niyamsApi
          .recentForStudent(active.id, 8)
          .catch(() => ({ items: [] as NiyamSubmissionRow[] })),
      ]);
      setBalance(b.balance);
      setStreaks(st.items);
      setRecent(rec.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your home.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tier: Tier = balance?.current_tier ?? 'jigyasu';
  const tColor = TIER_COLORS[tier];

  return (
    <DataScreen
      title="Home"
      subtitle="Your view"
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
      empty={!student}
      emptyTitle="No active profile"
      emptyBody="There's no active student profile to show yet."
    >
      {student ? (
        <>
          <Panel style={styles.heroPanel}>
            <Text style={styles.hello}>Welcome, {student.full_name.split(' ')[0]}</Text>
            <View style={styles.tierRow}>
              <View>
                <Text style={[styles.tierName, { color: tColor }]}>{TIER_LABEL[tier]}</Text>
                <Text style={[styles.tierNameHi, { color: tColor }]}>{TIER_LABEL_HI[tier]}</Text>
              </View>
              <View style={styles.pointsChip}>
                <Text style={styles.points}>{balance?.total_points ?? 0}</Text>
                <Text style={styles.pointsLabel}>Punya</Text>
              </View>
            </View>
          </Panel>

          {streaks.length > 0 ? (
            <Panel>
              <SectionTitle>Your streaks</SectionTitle>
              {streaks.slice(0, 5).map((s) => (
                <View key={s.niyam_id} style={styles.row}>
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {lang === 'hi' && s.niyam_title_hi ? s.niyam_title_hi : s.niyam_title_en}
                  </Text>
                  <Text style={styles.rowValue}>
                    {s.current_streak} day{s.current_streak === 1 ? '' : 's'}
                  </Text>
                </View>
              ))}
            </Panel>
          ) : null}

          {recent.length > 0 ? (
            <Panel>
              <SectionTitle>Recent niyams</SectionTitle>
              {recent.map((r) => (
                <View key={r.id} style={styles.row}>
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {lang === 'hi' && r.niyam_title_hi ? r.niyam_title_hi : r.niyam_title_en}
                  </Text>
                  <Text
                    style={[
                      styles.rowValue,
                      { color: r.status === 'rejected' ? JPColors.error : JPColors.success },
                    ]}
                  >
                    {r.status === 'rejected' ? 'Rejected' : `+${r.points_value}`}
                  </Text>
                </View>
              ))}
            </Panel>
          ) : null}
        </>
      ) : null}
    </DataScreen>
  );
}

const styles = StyleSheet.create({
  heroPanel: { gap: JPSpacing.sp3 },
  hello: { fontFamily: JPFonts.display, fontSize: 20, color: JPColors.maroon },
  tierRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tierName: { fontFamily: JPFonts.display, fontSize: 26 },
  tierNameHi: { fontFamily: JPFonts.display, fontSize: 16, opacity: 0.85 },
  pointsChip: {
    backgroundColor: JPColors.gold50,
    borderRadius: JPRadius.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
  },
  points: { fontFamily: JPFonts.display, fontSize: 22, color: JPColors.gold },
  pointsLabel: { fontFamily: JPFonts.body, fontSize: 11, color: JPColors.textSub },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: JPColors.divider,
    gap: 8,
  },
  rowLabel: { fontFamily: JPFonts.body, fontSize: 14, color: JPColors.textPrimary, flex: 1 },
  rowValue: {
    fontFamily: JPFonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: JPColors.textPrimary,
  },
});
