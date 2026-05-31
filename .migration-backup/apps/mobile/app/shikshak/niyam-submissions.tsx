/**
 * Shikshak → niyam submission review (pushed from the Niyams tab).
 *
 * Lists recent niyam submissions in the teacher's scope and lets them reject a
 * submission within the 30-day window (Q5) — which reverses the Punya award and
 * recomputes the streak server-side.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api/client';
import { niyamsApi, type NiyamSubmissionForReview } from '@/api/endpoints/niyams';
import { DataScreen, Panel } from '@/components/admin/AdminScreen';
import { PrimaryButton } from '@/components/ui';
import { appToast } from '@/components/ui/feedback/AppToast';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

export default function NiyamSubmissionsScreen() {
  const [items, setItems] = useState<NiyamSubmissionForReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await niyamsApi.listSubmissionsForReview();
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load submissions.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmReject(id: string) {
    if (reason.trim().length < 20) {
      appToast.error('Reason too short', 'Give at least 20 characters explaining the rejection.');
      return;
    }
    setSaving(true);
    try {
      await niyamsApi.rejectSubmission(id, reason.trim());
      appToast.success('Submission rejected', 'Punya was reversed and the streak recomputed.');
      setRejectingId(null);
      setReason('');
      setLoading(true);
      await load();
    } catch (err) {
      appToast.error(
        'Could not reject',
        err instanceof ApiError ? err.message : 'Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <DataScreen
      title="Niyam submissions"
      subtitle="Review submissions · reject within 30 days (Q5)"
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
      emptyTitle="Nothing to review"
      emptyBody="Submissions from your students will appear here."
    >
      {items.map((s) => {
        const student = s.student_name ?? s.student_full_name ?? 'Student';
        const niyam = s.niyam_title_en ?? s.title_en ?? 'Niyam';
        const when = s.submitted_at ?? s.submission_date ?? '';
        return (
          <Panel key={s.id}>
            <Text style={styles.name}>{student}</Text>
            <Text style={styles.meta}>
              {niyam}
              {when ? ` · ${when}` : ''}
            </Text>
            {rejectingId === s.id ? (
              <View style={styles.rejectBox}>
                <TextInput
                  style={styles.input}
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Reason for rejection (20+ characters)"
                  placeholderTextColor={JPColors.textDim}
                  multiline
                />
                <View style={styles.row}>
                  <PrimaryButton
                    onPress={() => confirmReject(s.id)}
                    loading={saving}
                    disabled={saving}
                  >
                    Confirm reject
                  </PrimaryButton>
                  <Pressable
                    onPress={() => {
                      setRejectingId(null);
                      setReason('');
                    }}
                    style={styles.cancel}
                  >
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                onPress={() => {
                  setRejectingId(s.id);
                  setReason('');
                }}
                style={styles.rejectBtn}
              >
                <Text style={styles.rejectText}>Reject</Text>
              </Pressable>
            )}
          </Panel>
        );
      })}
    </DataScreen>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: JPFonts.body, fontSize: 15, fontWeight: '600', color: JPColors.textPrimary },
  meta: { fontFamily: JPFonts.body, fontSize: 13, color: JPColors.textSub, marginTop: 2 },
  rejectBtn: {
    alignSelf: 'flex-start',
    marginTop: JPSpacing.sp3,
    borderWidth: 1,
    borderColor: JPColors.maroon,
    borderRadius: JPRadius.md,
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: JPSpacing.sp2,
  },
  rejectText: { fontFamily: JPFonts.body, fontWeight: '700', color: JPColors.maroon, fontSize: 13 },
  rejectBox: { marginTop: JPSpacing.sp3, gap: JPSpacing.sp3 },
  input: {
    backgroundColor: JPColors.creamDark,
    borderWidth: 1,
    borderColor: JPColors.border,
    borderRadius: JPRadius.md,
    fontFamily: JPFonts.body,
    fontSize: 15,
    color: JPColors.textPrimary,
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: JPSpacing.sp3,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: JPSpacing.sp4 },
  cancel: { paddingVertical: JPSpacing.sp2 },
  cancelText: { fontFamily: JPFonts.body, color: JPColors.textSub, fontWeight: '700' },
});
