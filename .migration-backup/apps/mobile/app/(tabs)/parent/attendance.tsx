/**
 * Parent — attendance calendar heatmap (Step 13).
 *
 * Multi-child selector, month grid coloured per scheduled session day using
 * the same palette as `attendance-badges.html`, and a "Inform absence" CTA
 * that POSTs `/v1/absences/notify`.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { studentsApi, type StudentDto } from '@/api/endpoints/students';
import { Header } from '@/components/ui';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';
import { attendanceApi } from '@/features/attendance/attendance.api';

import type { AttendanceStatus } from '@jp/shared';

const PALETTE: Record<AttendanceStatus, string> = {
  present: JPColors.successBg,
  absent: JPColors.errorBg,
  late: JPColors.warningBg,
  excused: JPColors.infoBg,
};
const NEUTRAL_BG = '#FFFFFF';

export default function ParentAttendanceScreen() {
  const insets = useSafeAreaInsets();
  const [children, setChildren] = useState<StudentDto[]>([]);
  const [activeChildId, setActiveChildId] = useState<string | null>(null);
  const [month, setMonth] = useState<string>(thisMonth());
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [absences, setAbsences] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAbsenceModal, setShowAbsenceModal] = useState(false);
  const [absenceDate, setAbsenceDate] = useState<string>(today());
  const [absenceReason, setAbsenceReason] = useState<string>('');
  const [absenceSubmitting, setAbsenceSubmitting] = useState(false);
  const [absenceError, setAbsenceError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await studentsApi.myChildren();
        const active = res.items.filter((c) => c.status === 'active');
        setChildren(active);
        if (active[0]) setActiveChildId(active[0].id);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load children.');
      }
    })();
  }, []);

  const loadMonth = useCallback(async () => {
    if (!activeChildId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await attendanceApi.studentMonth(activeChildId, month);
      const m: Record<string, AttendanceStatus> = {};
      for (const item of res.items) {
        m[item.scheduled_date] = item.attendance.status;
      }
      setMarks(m);
      const a: Record<string, string | null> = {};
      for (const ab of res.absences) {
        a[ab.date] = ab.reason;
      }
      setAbsences(a);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load attendance.');
    } finally {
      setLoading(false);
    }
  }, [activeChildId, month]);

  useEffect(() => {
    void loadMonth();
  }, [loadMonth]);

  const cells = useMemo(() => buildMonthCells(month), [month]);

  async function submitAbsence() {
    if (!activeChildId) return;
    if (absenceReason.trim().length < 3) {
      setAbsenceError('Please add a reason (at least 3 characters).');
      return;
    }
    setAbsenceSubmitting(true);
    setAbsenceError(null);
    try {
      await attendanceApi.notifyAbsence({
        student_id: activeChildId,
        date: absenceDate,
        reason: absenceReason.trim(),
      });
      setShowAbsenceModal(false);
      setAbsenceReason('');
      await loadMonth();
    } catch (err) {
      setAbsenceError(err instanceof Error ? err.message : 'Could not file the absence.');
    } finally {
      setAbsenceSubmitting(false);
    }
  }

  function prevMonth() {
    setMonth(addMonths(month, -1));
  }
  function nextMonth() {
    setMonth(addMonths(month, +1));
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Header title="Attendance" subtitle="Calendar by month" />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {children.length > 1 ? (
          <View style={styles.childRow}>
            {children.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setActiveChildId(c.id)}
                style={[styles.childChip, c.id === activeChildId && styles.childChipActive]}
              >
                <Text
                  style={[
                    styles.childChipLabel,
                    c.id === activeChildId && styles.childChipLabelActive,
                  ]}
                >
                  {c.full_name}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.monthRow}>
          <Pressable onPress={prevMonth} style={styles.navBtn}>
            <Text style={styles.navBtnText}>‹</Text>
          </Pressable>
          <Text style={styles.monthLabel}>{formatMonth(month)}</Text>
          <Pressable onPress={nextMonth} style={styles.navBtn}>
            <Text style={styles.navBtnText}>›</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {loading ? (
          <ActivityIndicator color={JPColors.saffron} style={{ marginTop: 32 }} />
        ) : (
          <View style={styles.grid}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <Text key={`h-${i}`} style={styles.gridHeader}>
                {d}
              </Text>
            ))}
            {cells.map((cell, i) => {
              if (!cell) return <View key={`e-${i}`} style={styles.cellEmpty} />;
              const status = marks[cell];
              const hasAbsence = cell in absences;
              const bg = status ? PALETTE[status] : hasAbsence ? PALETTE.excused : NEUTRAL_BG;
              return (
                <View key={cell} style={[styles.cell, { backgroundColor: bg }]}>
                  <Text style={styles.cellNum}>{Number(cell.slice(-2))}</Text>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.legend}>
          <LegendItem color={PALETTE.present} label="Present" />
          <LegendItem color={PALETTE.absent} label="Absent" />
          <LegendItem color={PALETTE.late} label="Late" />
          <LegendItem color={PALETTE.excused} label="Excused" />
        </View>

        <Pressable
          onPress={() => setShowAbsenceModal(true)}
          style={({ pressed }) => [styles.absenceBtn, pressed && { opacity: 0.92 }]}
          disabled={!activeChildId}
        >
          <Text style={styles.absenceBtnText}>Inform absence</Text>
        </Pressable>
      </ScrollView>

      <Modal
        transparent
        animationType="slide"
        visible={showAbsenceModal}
        onRequestClose={() => setShowAbsenceModal(false)}
      >
        <View style={styles.modalRoot}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Inform absence</Text>
            <Text style={styles.modalLabel}>Date (YYYY-MM-DD)</Text>
            <TextInput
              value={absenceDate}
              onChangeText={setAbsenceDate}
              style={styles.input}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
            />
            <Text style={styles.modalLabel}>Reason</Text>
            <TextInput
              value={absenceReason}
              onChangeText={setAbsenceReason}
              multiline
              style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
              placeholder="e.g. Family wedding"
            />
            {absenceError ? <Text style={styles.errorText}>{absenceError}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable onPress={() => setShowAbsenceModal(false)} style={styles.modalCancel}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void submitAbsence()}
                style={styles.modalSave}
                disabled={absenceSubmitting}
              >
                <Text style={styles.modalSaveText}>{absenceSubmitting ? 'Saving…' : 'Inform'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

// ----- Date helpers -----

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addMonths(yearMonth: string, delta: number): string {
  const [yStr, mStr] = yearMonth.split('-');
  const y = parseInt(yStr ?? '1970', 10);
  const m = parseInt(mStr ?? '1', 10);
  const next = new Date(y, m - 1 + delta, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonth(yearMonth: string): string {
  const [yStr, mStr] = yearMonth.split('-');
  const y = parseInt(yStr ?? '1970', 10);
  const m = parseInt(mStr ?? '1', 10);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/**
 * Returns 7 * N cells (null = leading/trailing blanks). Mon-Sunday order.
 */
function buildMonthCells(yearMonth: string): Array<string | null> {
  const [yStr, mStr] = yearMonth.split('-');
  const y = parseInt(yStr ?? '1970', 10);
  const m = parseInt(mStr ?? '1', 10);
  const firstWeekdayJs = new Date(y, m - 1, 1).getDay(); // 0..6 Sun..Sat
  // Convert to Mon=0..Sun=6
  const lead = (firstWeekdayJs + 6) % 7;
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells: Array<string | null> = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push(`${yearMonth}-${String(d).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const CELL_GAP = 4;
const CELL_BORDER_RADIUS = 6;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream },
  scrollContent: {
    padding: JPSpacing.sp4,
    paddingBottom: JPSpacing.sp6,
  },
  childRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: JPSpacing.sp3,
  },
  childChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderColor: JPColors.creamDeeper,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
  },
  childChipActive: {
    backgroundColor: JPColors.saffron,
    borderColor: JPColors.saffron,
  },
  childChipLabel: {
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 13,
    color: JPColors.textPrimary,
  },
  childChipLabelActive: {
    color: '#FFFFFF',
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: JPSpacing.sp2,
  },
  navBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.md,
    borderColor: JPColors.creamDeeper,
    borderWidth: 1,
  },
  navBtnText: {
    fontFamily: JPFonts.body,
    fontWeight: '700',
    fontSize: 18,
    color: JPColors.textPrimary,
  },
  monthLabel: {
    fontFamily: JPFonts.body,
    fontWeight: '700',
    fontSize: 17,
    color: JPColors.textPrimary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CELL_GAP,
    marginTop: JPSpacing.sp2,
  },
  gridHeader: {
    width: `${100 / 7 - 1}%`,
    textAlign: 'center',
    fontFamily: JPFonts.body,
    fontWeight: '600',
    color: JPColors.textSub,
    fontSize: 12,
    paddingVertical: 6,
  },
  cell: {
    width: `${100 / 7 - 1}%`,
    aspectRatio: 1,
    borderRadius: CELL_BORDER_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: JPColors.creamDeeper,
    borderWidth: 1,
  },
  cellEmpty: {
    width: `${100 / 7 - 1}%`,
    aspectRatio: 1,
  },
  cellNum: {
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 13,
    color: JPColors.textPrimary,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: JPSpacing.sp4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderColor: JPColors.creamDeeper,
    borderWidth: 1,
  },
  legendText: {
    fontFamily: JPFonts.body,
    fontWeight: '500',
    fontSize: 12,
    color: JPColors.textSub,
  },
  absenceBtn: {
    marginTop: JPSpacing.sp4,
    backgroundColor: JPColors.maroon,
    paddingVertical: 12,
    borderRadius: JPRadius.md,
    alignItems: 'center',
  },
  absenceBtnText: {
    color: '#FFFFFF',
    fontFamily: JPFonts.body,
    fontWeight: '700',
    fontSize: 14,
  },
  errorText: {
    color: JPColors.error,
    fontFamily: JPFonts.body,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 8,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: 'rgba(26,10,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: JPColors.cream,
    borderTopLeftRadius: JPRadius.lg,
    borderTopRightRadius: JPRadius.lg,
    padding: JPSpacing.sp4,
  },
  modalTitle: {
    fontFamily: JPFonts.body,
    fontWeight: '700',
    fontSize: 17,
    marginBottom: 12,
  },
  modalLabel: {
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 12,
    color: JPColors.textSub,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.md,
    padding: 12,
    fontFamily: JPFonts.body,
    color: JPColors.textPrimary,
    borderColor: JPColors.creamDeeper,
    borderWidth: 1,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
    justifyContent: 'flex-end',
  },
  modalCancel: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  modalCancelText: {
    color: JPColors.textSub,
    fontFamily: JPFonts.body,
    fontWeight: '600',
  },
  modalSave: {
    backgroundColor: JPColors.saffron,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: JPRadius.md,
  },
  modalSaveText: {
    color: '#FFFFFF',
    fontFamily: JPFonts.body,
    fontWeight: '700',
  },
});
