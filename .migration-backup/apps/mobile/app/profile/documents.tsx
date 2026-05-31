/**
 * Parent → Documents route: digital ID card + downloadable progress reports.
 *
 * Loads the parent's children, lets them pick one, shows that child's ID card
 * (with an Open button), and lists released progress reports with per-row
 * Open buttons. All PDFs open via a short-lived signed URL.
 */

import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ApiError } from '@/api/client';
import { documentsApi, type IdCardResult } from '@/api/endpoints/documents';
import { reportsApi, type ProgressReportRow } from '@/api/endpoints/reports';
import { studentsApi, type StudentDto } from '@/api/endpoints/students';
import { appToast } from '@/components/ui/feedback/AppToast';
import { JPColors, JPSpacing, JPFonts, JPRadius } from '@/constants/colors';

export default function DocumentsRoute() {
  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<StudentDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [card, setCard] = useState<IdCardResult | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  const [reports, setReports] = useState<ProgressReportRow[]>([]);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const loadBase = useCallback(async () => {
    setLoading(true);
    try {
      const [kids, reps] = await Promise.all([studentsApi.myChildren(), reportsApi.listMine()]);
      setChildren(kids.items);
      setReports(reps.items);
      if (kids.items.length > 0) setSelectedId((prev) => prev ?? kids.items[0]!.id);
    } catch (err) {
      appToast.error(
        'Could not load documents',
        err instanceof ApiError ? err.message : 'Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  const loadCard = useCallback(async (studentId: string) => {
    setCardBusy(true);
    setCard(null);
    try {
      setCard(await documentsApi.getIdCard(studentId));
    } catch (err) {
      appToast.error(
        'Could not load ID card',
        err instanceof ApiError ? err.message : 'Please try again.',
      );
    } finally {
      setCardBusy(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadCard(selectedId);
  }, [selectedId, loadCard]);

  async function openUrl(url: string): Promise<void> {
    try {
      await Linking.openURL(url);
    } catch {
      appToast.error('Could not open the document', 'No app available to open the PDF.');
    }
  }

  async function openReport(report: ProgressReportRow): Promise<void> {
    setOpeningId(report.id);
    try {
      const res = await documentsApi.downloadReport(report.id);
      await openUrl(res.url);
    } catch (err) {
      appToast.error(
        'Could not open report',
        err instanceof ApiError ? err.message : 'Please try again.',
      );
    } finally {
      setOpeningId(null);
    }
  }

  const releasedReports = reports.filter((r) => r.released_to_parent);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'ID card & reports' }} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={JPColors.saffron} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {children.length === 0 ? (
            <Text style={styles.empty}>No children are linked to your account yet.</Text>
          ) : (
            <>
              {/* Child selector */}
              {children.length > 1 ? (
                <View style={styles.childRow}>
                  {children.map((c) => {
                    const active = c.id === selectedId;
                    return (
                      <Pressable
                        key={c.id}
                        onPress={() => setSelectedId(c.id)}
                        style={[styles.childChip, active && styles.childChipActive]}
                      >
                        <Text style={[styles.childChipText, active && styles.childChipTextActive]}>
                          {c.full_name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {/* ID card */}
              <Text style={styles.sectionTitle}>Digital ID card</Text>
              <View style={styles.card}>
                {cardBusy ? (
                  <ActivityIndicator color={JPColors.saffron} />
                ) : card ? (
                  <>
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardNumber}>No. {card.card.card_number}</Text>
                      {card.card.msv_badge ? (
                        <View style={styles.msvBadge}>
                          <Text style={styles.msvBadgeText}>MSV</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.cardMeta}>Version {card.card.version_no}</Text>
                    <Pressable style={styles.primaryBtn} onPress={() => openUrl(card.url)}>
                      <Text style={styles.primaryBtnText}>Open ID card PDF</Text>
                    </Pressable>
                  </>
                ) : (
                  <Text style={styles.empty}>ID card unavailable.</Text>
                )}
              </View>

              {/* Progress reports */}
              <Text style={styles.sectionTitle}>Progress reports</Text>
              {releasedReports.length === 0 ? (
                <Text style={styles.empty}>No reports have been shared with you yet.</Text>
              ) : (
                releasedReports.map((r) => (
                  <View key={r.id} style={styles.reportRow}>
                    <View style={styles.reportInfo}>
                      <Text style={styles.reportTitle}>
                        {r.period_kind === 'termly' ? 'Term' : 'Month'} · {r.period_label}
                      </Text>
                      {r.released_at ? (
                        <Text style={styles.reportMeta}>
                          Shared {new Date(r.released_at).toLocaleDateString()}
                        </Text>
                      ) : null}
                    </View>
                    <Pressable
                      style={styles.secondaryBtn}
                      disabled={openingId === r.id}
                      onPress={() => openReport(r)}
                    >
                      <Text style={styles.secondaryBtnText}>
                        {openingId === r.id ? '…' : 'Open'}
                      </Text>
                    </Pressable>
                  </View>
                ))
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const PILL = 999;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: JPColors.cream },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: JPSpacing.sp4, gap: JPSpacing.sp3 },
  empty: {
    fontFamily: JPFonts.body,
    color: JPColors.textSub,
    fontSize: 14,
    paddingVertical: JPSpacing.sp2,
  },
  childRow: { flexDirection: 'row', flexWrap: 'wrap', gap: JPSpacing.sp2 },
  childChip: {
    paddingHorizontal: JPSpacing.sp3,
    paddingVertical: JPSpacing.sp1,
    borderRadius: PILL,
    backgroundColor: JPColors.creamDark,
  },
  childChipActive: { backgroundColor: JPColors.saffron },
  childChipText: { fontFamily: JPFonts.body, color: JPColors.textPrimary, fontSize: 13 },
  childChipTextActive: { color: JPColors.cream },
  sectionTitle: {
    fontFamily: JPFonts.display,
    color: JPColors.maroon,
    fontSize: 16,
    marginTop: JPSpacing.sp2,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: JPColors.border,
    borderRadius: JPRadius.lg,
    padding: JPSpacing.sp4,
    gap: JPSpacing.sp2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardNumber: {
    fontFamily: JPFonts.body,
    color: JPColors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  cardMeta: { fontFamily: JPFonts.body, color: JPColors.textSub, fontSize: 13 },
  msvBadge: {
    backgroundColor: JPColors.gold,
    borderRadius: PILL,
    paddingHorizontal: JPSpacing.sp2,
    paddingVertical: 2,
  },
  msvBadgeText: {
    fontFamily: JPFonts.body,
    color: JPColors.cream,
    fontSize: 11,
    fontWeight: '700',
  },
  primaryBtn: {
    backgroundColor: JPColors.saffron,
    borderRadius: JPRadius.md,
    paddingVertical: JPSpacing.sp2,
    alignItems: 'center',
    marginTop: JPSpacing.sp1,
  },
  primaryBtnText: {
    fontFamily: JPFonts.body,
    color: JPColors.cream,
    fontSize: 14,
    fontWeight: '600',
  },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: JPColors.border,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
  },
  reportInfo: { flex: 1, gap: 2 },
  reportTitle: {
    fontFamily: JPFonts.body,
    color: JPColors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  reportMeta: { fontFamily: JPFonts.body, color: JPColors.textSub, fontSize: 12 },
  secondaryBtn: {
    backgroundColor: JPColors.creamDark,
    borderRadius: JPRadius.md,
    paddingHorizontal: JPSpacing.sp3,
    paddingVertical: JPSpacing.sp1,
  },
  secondaryBtnText: {
    fontFamily: JPFonts.body,
    color: JPColors.maroon,
    fontSize: 13,
    fontWeight: '600',
  },
});
