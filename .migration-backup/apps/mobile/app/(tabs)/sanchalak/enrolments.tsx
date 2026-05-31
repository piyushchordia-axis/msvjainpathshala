/**
 * Sanchalak → Enrolments. Approve or reject pending enrolment applications in
 * the centre's scope (POST /v1/enrolments/:id/{approve,reject}).
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { enrolmentsApi, type PendingEnrolmentRow } from '@/api/endpoints/students';
import { DataScreen, Panel } from '@/components/admin/AdminScreen';
import { appToast } from '@/components/ui/feedback/AppToast';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

export default function SanchalakEnrolmentsScreen() {
  const [items, setItems] = useState<PendingEnrolmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await enrolmentsApi.listPending();
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load enrolments.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(id: string) {
    setBusyId(id);
    try {
      await enrolmentsApi.approve(id);
      appToast.success('Enrolment approved', 'The student is now enrolled.');
      setLoading(true);
      await load();
    } catch (err) {
      appToast.error(
        'Could not approve',
        err instanceof ApiError ? err.message : 'Please try again.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    setBusyId(id);
    try {
      await enrolmentsApi.reject(id, 'Rejected by Sanchalak');
      appToast.success('Enrolment rejected', 'The application was rejected.');
      setLoading(true);
      await load();
    } catch (err) {
      appToast.error(
        'Could not reject',
        err instanceof ApiError ? err.message : 'Please try again.',
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <DataScreen
      title="Enrolments"
      subtitle="Approve or reject pending applications"
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
      emptyTitle="No pending enrolments"
      emptyBody="New applications will appear here for review."
    >
      {items.map((e) => {
        const name = e.full_name ?? e.student_name ?? 'Applicant';
        const centre = e.requested_centre_name ?? e.centre_name ?? '';
        const batch = e.requested_batch_name ?? e.batch_name ?? '';
        const detail = [batch, centre].filter(Boolean).join(' · ');
        const busy = busyId === e.id;
        return (
          <Panel key={e.id}>
            <Text style={styles.name}>{name}</Text>
            {detail ? <Text style={styles.meta}>{detail}</Text> : null}
            <View style={styles.actions}>
              <Pressable
                onPress={() => approve(e.id)}
                disabled={busy}
                style={[styles.btn, styles.approve, busy && styles.disabled]}
              >
                <Text style={styles.approveText}>Approve</Text>
              </Pressable>
              <Pressable
                onPress={() => reject(e.id)}
                disabled={busy}
                style={[styles.btn, styles.reject, busy && styles.disabled]}
              >
                <Text style={styles.rejectText}>Reject</Text>
              </Pressable>
            </View>
          </Panel>
        );
      })}
    </DataScreen>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: JPFonts.body, fontSize: 16, fontWeight: '600', color: JPColors.textPrimary },
  meta: { fontFamily: JPFonts.body, fontSize: 13, color: JPColors.textSub, marginTop: 2 },
  actions: { flexDirection: 'row', gap: JPSpacing.sp3, marginTop: JPSpacing.sp3 },
  btn: { flex: 1, paddingVertical: JPSpacing.sp3, borderRadius: JPRadius.md, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  approve: { backgroundColor: JPColors.saffron },
  approveText: { fontFamily: JPFonts.body, color: '#FFFFFF', fontWeight: '700' },
  reject: { borderWidth: 1, borderColor: JPColors.maroon },
  rejectText: { fontFamily: JPFonts.body, color: JPColors.maroon, fontWeight: '700' },
});
