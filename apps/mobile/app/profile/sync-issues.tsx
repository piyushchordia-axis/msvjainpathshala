/**
 * Sync Issues drawer — lists ops that the server REJECTED with a
 * non-retryable error code. Each row shows the op kind, when it failed,
 * the error code + human-readable message, and two buttons: Retry (re-
 * enqueue to the original queue) and Discard (delete forever).
 */

import { Stack } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { JPColors, JPRadius, JPSpacing } from '@/constants/colors';
import {
  acknowledgementsQueue,
  attendanceQueue,
  failedOpsStore,
  niyamSubmissionsQueue,
  shivirScansQueue,
  type FailedOp,
  type FailedQueueName,
} from '@/storage';
import { useSyncIssuesStore } from '@/stores/sync-issues.store';
import { syncEngine } from '@/sync/sync-engine';

function reEnqueue(op: FailedOp): void {
  const target: Record<FailedQueueName, { enqueue(kind: string, payload: unknown): unknown }> = {
    attendance: attendanceQueue,
    shivir_scans: shivirScansQueue,
    niyam_submissions: niyamSubmissionsQueue,
    acknowledgements: acknowledgementsQueue,
  };
  const queue = target[op.source_queue];
  if (queue) queue.enqueue(op.pending_op.kind, op.pending_op.payload);
}

export default function SyncIssuesScreen(): React.JSX.Element {
  const [items, setItems] = useState<FailedOp[]>(() => failedOpsStore.getAll());
  const setFailedCount = useSyncIssuesStore((s) => s.setFailedCount);

  const refresh = useCallback(() => {
    const next = failedOpsStore.getAll();
    setItems(next);
    setFailedCount(next.length);
  }, [setFailedCount]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRetry = useCallback(
    (op: FailedOp) => {
      reEnqueue(op);
      failedOpsStore.discard(op.client_op_id);
      refresh();
      void syncEngine.tick('user-retry');
    },
    [refresh],
  );

  const handleDiscard = useCallback(
    (op: FailedOp) => {
      failedOpsStore.discard(op.client_op_id);
      refresh();
    },
    [refresh],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ title: 'Sync issues', headerShown: true }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>All caught up</Text>
            <Text style={styles.emptyBody}>
              Every offline action has synced cleanly. We&apos;ll surface anything that needs your
              attention here.
            </Text>
          </View>
        ) : (
          items.map((op) => (
            <View key={op.client_op_id} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.opKind}>{op.op_kind}</Text>
                <Text style={styles.failedAt}>{new Date(op.failed_at).toLocaleString()}</Text>
              </View>
              <Text style={styles.errorCode}>{op.error_code}</Text>
              <Text style={styles.errorMessage} numberOfLines={3}>
                {op.error_message}
              </Text>
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => handleRetry(op)}
                  style={[styles.btn, styles.btnPrimary]}
                >
                  <Text style={styles.btnPrimaryText}>Retry</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => handleDiscard(op)}
                  style={[styles.btn, styles.btnGhost]}
                >
                  <Text style={styles.btnGhostText}>Discard</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: JPColors.cream },
  scroll: { padding: JPSpacing.sp3, gap: JPSpacing.sp2 },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    padding: JPSpacing.sp4,
    borderRadius: JPRadius.lg,
    alignItems: 'center',
  },
  emptyTitle: {
    fontFamily: 'Mukta_600SemiBold',
    fontSize: 18,
    color: JPColors.maroon,
    marginBottom: JPSpacing.sp1,
  },
  emptyBody: {
    fontFamily: 'Mukta_400Regular',
    fontSize: 14,
    color: JPColors.textPrimary,
    textAlign: 'center',
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    padding: JPSpacing.sp3,
    borderRadius: JPRadius.lg,
    borderLeftWidth: 3,
    borderLeftColor: JPColors.warning,
    gap: 6,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  opKind: {
    fontFamily: 'Mukta_600SemiBold',
    fontSize: 14,
    color: JPColors.maroon,
  },
  failedAt: {
    fontFamily: 'Mukta_400Regular',
    fontSize: 11,
    color: JPColors.textSub,
  },
  errorCode: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 11,
    color: JPColors.warning,
  },
  errorMessage: {
    fontFamily: 'Mukta_400Regular',
    fontSize: 13,
    color: JPColors.textPrimary,
    lineHeight: 18,
  },
  actions: { flexDirection: 'row', gap: JPSpacing.sp2, marginTop: JPSpacing.sp1 },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: JPRadius.md,
  },
  btnPrimary: { backgroundColor: JPColors.saffron },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontFamily: 'Mukta_600SemiBold',
    fontSize: 13,
  },
  btnGhost: { borderWidth: 1, borderColor: JPColors.maroon300 },
  btnGhostText: {
    color: JPColors.maroon,
    fontFamily: 'Mukta_600SemiBold',
    fontSize: 13,
  },
});
