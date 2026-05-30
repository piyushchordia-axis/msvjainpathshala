/**
 * Parent → Monthly progress reports (SPEC §5.20 / Step 22).
 *
 * Reads GET /v1/reports/me (released reports only) and renders each as a card
 * with the period, attendance rate, Punya earned, the shikshak's comment, and
 * highlights from the report snapshot. A "PDF ready" tag appears once the
 * report.generation job has attached the rendered PDF.
 */

import { Stack, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { reportsApi, type ProgressReportRow } from '@/api/endpoints/reports';
import { studentsApi, type StudentDto } from '@/api/endpoints/students';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

function fmtPeriod(row: ProgressReportRow): string {
  const label = row.snapshot.period?.label ?? row.period_label;
  // Monthly labels are 'YYYY-MM' → "Jan 2026".
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }
  return label;
}

export default function ReportsScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ProgressReportRow[]>([]);
  const [children, setChildren] = useState<Record<string, StudentDto>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reports, kids] = await Promise.all([
        reportsApi.listMine(),
        studentsApi.myChildren().catch(() => ({ items: [] as StudentDto[] })),
      ]);
      const byId: Record<string, StudentDto> = {};
      for (const k of kids.items) byId[k.id] = k;
      setChildren(byId);
      // Newest first.
      setItems(
        [...reports.items].sort(
          (a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime(),
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load reports');
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
      <Stack.Screen options={{ title: 'Progress reports' }} />
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
          <Text style={styles.subtle}>
            No reports yet. Monthly progress reports appear here once your centre releases them.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {items.map((r) => {
            const childName = children[r.student_id]?.full_name ?? r.snapshot.student?.full_name;
            const att = r.snapshot.attendance;
            const punya = r.snapshot.punya;
            return (
              <View key={r.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={styles.period}>{fmtPeriod(r)}</Text>
                  {r.pdf_asset_id ? <Text style={styles.pdfTag}>PDF ready</Text> : null}
                </View>
                {childName ? <Text style={styles.childName}>{childName}</Text> : null}

                <View style={styles.statRow}>
                  {att ? (
                    <View style={styles.stat}>
                      <Text style={styles.statValue}>{att.rate_pct}%</Text>
                      <Text style={styles.statLabel}>
                        Attendance ({att.present}/{att.total})
                      </Text>
                    </View>
                  ) : null}
                  {punya ? (
                    <View style={styles.stat}>
                      <Text style={styles.statValue}>{punya.points_awarded}</Text>
                      <Text style={styles.statLabel}>Punya earned</Text>
                    </View>
                  ) : null}
                </View>

                {r.shikshak_comment ? (
                  <View style={styles.commentBox}>
                    <Text style={styles.commentLabel}>Guruji's note</Text>
                    <Text style={styles.commentText}>{r.shikshak_comment}</Text>
                  </View>
                ) : null}

                {r.snapshot.highlights && r.snapshot.highlights.length > 0 ? (
                  <View style={styles.highlights}>
                    {r.snapshot.highlights.map((h, i) => (
                      <Text key={i} style={styles.highlight}>
                        • {h}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: JPSpacing.sp3,
    padding: JPSpacing.sp4,
  },
  body: { padding: JPSpacing.sp4, gap: JPSpacing.sp3 },
  subtle: {
    color: JPColors.textSub,
    fontFamily: JPFonts.body,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
  },
  errorText: { color: JPColors.error, fontFamily: JPFonts.body, fontSize: 14 },
  retryBtn: {
    backgroundColor: JPColors.saffron,
    paddingVertical: JPSpacing.sp2,
    paddingHorizontal: JPSpacing.sp4,
    borderRadius: JPRadius.md,
  },
  retryText: { color: '#FFFFFF', fontFamily: JPFonts.body, fontWeight: '700' },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: JPColors.border,
    borderWidth: 1,
    borderRadius: JPRadius.lg,
    padding: JPSpacing.sp4,
    gap: JPSpacing.sp3,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  period: { color: JPColors.textPrimary, fontFamily: JPFonts.display, fontSize: 18 },
  pdfTag: {
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
  childName: { color: JPColors.maroon, fontFamily: JPFonts.body, fontSize: 14, fontWeight: '600' },
  statRow: { flexDirection: 'row', gap: JPSpacing.sp4 },
  stat: {
    flex: 1,
    backgroundColor: JPColors.creamDark,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
  },
  statValue: { color: JPColors.saffron, fontFamily: JPFonts.display, fontSize: 22 },
  statLabel: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 11, marginTop: 2 },
  commentBox: {
    backgroundColor: JPColors.creamDark,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
    gap: 3,
  },
  commentLabel: {
    color: JPColors.textSub,
    fontFamily: JPFonts.body,
    fontSize: 11,
    fontWeight: '700',
  },
  commentText: {
    color: JPColors.textPrimary,
    fontFamily: JPFonts.body,
    fontSize: 14,
    lineHeight: 20,
  },
  highlights: { gap: 2 },
  highlight: {
    color: JPColors.textPrimary,
    fontFamily: JPFonts.body,
    fontSize: 13,
    lineHeight: 19,
  },
});
