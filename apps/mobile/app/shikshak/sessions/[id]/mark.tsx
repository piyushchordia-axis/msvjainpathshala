/**
 * Shikshak — mark attendance for an in-progress session.
 *
 * Layout follows `jp-design-system/preview/attendance-badges.html`:
 *   - One row per student with a 3-way (Present / Absent / Late) segmented
 *     control. Excused is auto-filled when the parent posted an advance
 *     absence notice and the cell is read-only (tap to clear and re-mark).
 *   - Long-press a row to open the notes modal.
 *   - Submit posts to /v1/attendance/mark online; offline, we enqueue per-
 *     item into the MMKV `jp.queue.attendance` and show the toast.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { ulid } from 'ulid';

import { ApiError } from '@/api/client';
import { Header } from '@/components/ui';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';
import {
  attendanceApi,
  type MarkItem,
  type RosterStudent,
} from '@/features/attendance/attendance.api';
import { AttendanceStatusChip } from '@/features/attendance/AttendanceStatusChip';
import { attendanceQueue, type AttendanceOpPayload } from '@/storage/stores/queue/attendance.store';
import { useNetworkStore } from '@/stores/network.store';

import type { AttendanceStatus } from '@jp/shared';

type LocalStatus = AttendanceStatus | null;

interface LocalMark {
  student_id: string;
  status: LocalStatus;
  notes: string | null;
}

export default function MarkAttendanceScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const sessionId = params.id!;
  const isOnline = useNetworkStore((s) => s.isOnline);

  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [scheduledDate, setScheduledDate] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<string, LocalMark>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOfflineBanner, setSavedOfflineBanner] = useState(false);
  const [notesModalStudentId, setNotesModalStudentId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await attendanceApi.roster(sessionId);
      setRoster(res.students);
      setBatchId(res.session.batch_id);
      setScheduledDate(res.session.scheduled_date);
      const seed: Record<string, LocalMark> = {};
      for (const s of res.students) {
        seed[s.id] = {
          student_id: s.id,
          status: s.attendance?.status ?? (s.pre_excused ? 'excused' : null),
          notes: s.attendance?.notes ?? (s.pre_excused ? s.absence_reason : null),
        };
      }
      setMarks(seed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the roster.');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const out = { present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 };
    for (const s of roster) {
      const m = marks[s.id];
      if (!m || m.status === null) out.unmarked += 1;
      else out[m.status] += 1;
    }
    return out;
  }, [marks, roster]);

  function setStatusFor(studentId: string, status: AttendanceStatus) {
    setMarks((prev) => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] ?? { student_id: studentId, notes: null }),
        student_id: studentId,
        status,
        notes: prev[studentId]?.notes ?? null,
      },
    }));
  }

  function openNotes(studentId: string) {
    setNotesModalStudentId(studentId);
    setNotesDraft(marks[studentId]?.notes ?? '');
  }

  function saveNotes() {
    if (!notesModalStudentId) return;
    setMarks((prev) => ({
      ...prev,
      [notesModalStudentId]: {
        ...(prev[notesModalStudentId] ?? {
          student_id: notesModalStudentId,
          status: null,
        }),
        student_id: notesModalStudentId,
        status: prev[notesModalStudentId]?.status ?? null,
        notes: notesDraft.trim() ? notesDraft.trim() : null,
      },
    }));
    setNotesModalStudentId(null);
    setNotesDraft('');
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const items: MarkItem[] = [];
    for (const s of roster) {
      const m = marks[s.id];
      if (!m || m.status === null) continue;
      items.push({
        student_id: s.id,
        status: m.status,
        client_op_id: ulid(),
        ...(m.notes ? { notes: m.notes } : {}),
      });
    }
    if (items.length === 0) {
      setError('Mark at least one student before submitting.');
      setSubmitting(false);
      return;
    }
    try {
      if (!isOnline) {
        enqueueOffline(items);
        setSavedOfflineBanner(true);
        setTimeout(() => router.back(), 1200);
        return;
      }
      await attendanceApi.mark({ session_id: sessionId, marks: items });
      router.replace(`/shikshak/sessions/${sessionId}/checkout` as never);
    } catch (err) {
      // Network error → enqueue for retry.
      if (!(err instanceof ApiError) || err.statusCode === 0) {
        enqueueOffline(items);
        setSavedOfflineBanner(true);
        setTimeout(() => router.back(), 1200);
        return;
      }
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function enqueueOffline(items: MarkItem[]) {
    if (!batchId || !scheduledDate) return;
    for (const it of items) {
      const payload: AttendanceOpPayload = {
        session_id: sessionId,
        batch_id: batchId,
        scheduled_date: scheduledDate,
        student_id: it.student_id,
        status: it.status,
        notes: it.notes ?? null,
        marked_at: new Date().toISOString(),
        gps: null,
      };
      attendanceQueue.enqueue('attendance.mark', payload);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Header title="Mark attendance" subtitle={`${roster.length} students`} />

      {savedOfflineBanner ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>Saved offline — will sync when online</Text>
        </View>
      ) : null}

      <View style={styles.summary}>
        <SummaryChip
          label="P"
          value={totals.present}
          bg={JPColors.successBg}
          fg={JPColors.success}
        />
        <SummaryChip label="A" value={totals.absent} bg={JPColors.errorBg} fg={JPColors.error} />
        <SummaryChip label="L" value={totals.late} bg={JPColors.warningBg} fg={JPColors.warning} />
        <SummaryChip label="Ex" value={totals.excused} bg={JPColors.infoBg} fg={JPColors.info} />
        <SummaryChip
          label="—"
          value={totals.unmarked}
          bg={JPColors.creamDark}
          fg={JPColors.textSub}
        />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {loading ? (
          <ActivityIndicator color={JPColors.saffron} style={{ marginTop: 32 }} />
        ) : (
          roster.map((s) => (
            <StudentRow
              key={s.id}
              student={s}
              current={marks[s.id]?.status ?? null}
              hasNote={!!marks[s.id]?.notes}
              onMark={(st) => setStatusFor(s.id, st)}
              onLongPress={() => openNotes(s.id)}
            />
          ))
        )}
      </ScrollView>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.footer}>
        <Pressable
          disabled={submitting}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.primaryBtn,
            submitting && styles.primaryBtnDisabled,
            pressed && { opacity: 0.92 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryBtnText}>Submit</Text>
          )}
        </Pressable>
      </View>

      <Modal
        visible={notesModalStudentId !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setNotesModalStudentId(null)}
      >
        <View style={styles.modalRoot}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Note</Text>
            <TextInput
              value={notesDraft}
              onChangeText={setNotesDraft}
              placeholder="Optional context (visible only to Sanchalak)"
              multiline
              style={styles.notesInput}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setNotesModalStudentId(null)} style={styles.modalCancel}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={saveNotes} style={styles.modalSave}>
                <Text style={styles.modalSaveText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function StudentRow({
  student,
  current,
  hasNote,
  onMark,
  onLongPress,
}: {
  student: RosterStudent;
  current: LocalStatus;
  hasNote: boolean;
  onMark(s: AttendanceStatus): void;
  onLongPress(): void;
}) {
  return (
    <Pressable
      delayLongPress={400}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.96 }]}
    >
      <View style={styles.rowHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowName}>{student.full_name}</Text>
          <Text style={styles.rowCode}>{student.student_code}</Text>
        </View>
        {student.pre_excused ? (
          <AttendanceStatusChip status="excused" size="sm" />
        ) : current ? (
          <AttendanceStatusChip status={current} size="sm" />
        ) : null}
      </View>
      <View style={styles.segmented}>
        <Segment
          label="Present"
          tint={JPColors.success}
          active={current === 'present'}
          onPress={() => onMark('present')}
        />
        <Segment
          label="Absent"
          tint={JPColors.error}
          active={current === 'absent'}
          onPress={() => onMark('absent')}
        />
        <Segment
          label="Late"
          tint={JPColors.warning}
          active={current === 'late'}
          onPress={() => onMark('late')}
        />
      </View>
      {hasNote ? <Text style={styles.hasNote}>• Note attached</Text> : null}
    </Pressable>
  );
}

function Segment({
  label,
  tint,
  active,
  onPress,
}: {
  label: string;
  tint: string;
  active: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.segment,
        active && { backgroundColor: tint, borderColor: tint },
        pressed && { opacity: 0.9 },
      ]}
    >
      <Text style={[styles.segmentLabel, { color: active ? '#FFFFFF' : tint }]}>{label}</Text>
    </Pressable>
  );
}

function SummaryChip({
  label,
  value,
  bg,
  fg,
}: {
  label: string;
  value: number;
  bg: string;
  fg: string;
}) {
  return (
    <View style={[styles.summaryChip, { backgroundColor: bg }]}>
      <Text style={[styles.summaryChipLabel, { color: fg }]}>
        {label} {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream },
  offlineBanner: {
    backgroundColor: JPColors.infoBg,
    paddingVertical: 8,
    alignItems: 'center',
  },
  offlineBannerText: {
    color: JPColors.info,
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 13,
  },
  summary: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: JPSpacing.sp4,
    paddingTop: JPSpacing.sp2,
  },
  summaryChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  summaryChipLabel: {
    fontSize: 12,
    fontFamily: JPFonts.body,
    fontWeight: '600',
  },
  scrollContent: {
    paddingHorizontal: JPSpacing.sp4,
    paddingTop: JPSpacing.sp3,
    paddingBottom: 96,
  },
  row: {
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.lg,
    padding: JPSpacing.sp3,
    marginBottom: JPSpacing.sp2,
    borderColor: JPColors.creamDeeper,
    borderWidth: 1,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  rowName: {
    fontFamily: JPFonts.body,
    fontWeight: '700',
    fontSize: 15,
    color: JPColors.textPrimary,
  },
  rowCode: {
    fontFamily: JPFonts.mono,
    fontSize: 11,
    color: JPColors.textSub,
    marginTop: 2,
  },
  segmented: {
    flexDirection: 'row',
    gap: 6,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: JPRadius.md,
    borderWidth: 1.5,
    borderColor: JPColors.creamDeeper,
    alignItems: 'center',
  },
  segmentLabel: {
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 13,
  },
  hasNote: {
    marginTop: 6,
    fontSize: 12,
    color: JPColors.textSub,
    fontFamily: JPFonts.body,
    fontWeight: '500',
  },
  errorText: {
    color: JPColors.error,
    fontFamily: JPFonts.body,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: 8,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: JPSpacing.sp4,
    backgroundColor: JPColors.cream,
    borderTopColor: JPColors.creamDeeper,
    borderTopWidth: 1,
  },
  primaryBtn: {
    backgroundColor: JPColors.saffron,
    paddingVertical: 14,
    borderRadius: JPRadius.md,
    alignItems: 'center',
  },
  primaryBtnDisabled: {
    backgroundColor: JPColors.saffron300,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontFamily: JPFonts.body,
    fontWeight: '700',
    fontSize: 16,
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
  notesInput: {
    minHeight: 90,
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.md,
    padding: 12,
    fontFamily: JPFonts.body,
    color: JPColors.textPrimary,
    textAlignVertical: 'top',
    borderColor: JPColors.creamDeeper,
    borderWidth: 1,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
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
