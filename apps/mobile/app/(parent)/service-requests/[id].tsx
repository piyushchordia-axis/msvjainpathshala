/**
 * Parent → service request detail + message thread (SPEC §6.19).
 *
 * The parent API exposes the request via the list endpoint and the thread
 * via GET /v1/service-requests/:id/messages, so we load both and match by id
 * (keeps deep links working). Messages authored by the current user render
 * right-aligned ("You"); admin replies render left-aligned ("Support team").
 */

import { Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import {
  serviceRequestsApi,
  type ServiceRequestMessageRow,
  type ServiceRequestRow,
  type ServiceRequestStatus,
} from '@/api/endpoints/service-requests';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';
import { useAuth } from '@/features/auth/auth-context';

const STATUS_META: Record<ServiceRequestStatus, { label: string; bg: string; fg: string }> = {
  submitted: { label: 'Submitted', bg: JPColors.creamDeeper, fg: JPColors.textSub },
  in_review: { label: 'In review', bg: JPColors.warningBg, fg: JPColors.warning },
  resolved: { label: 'Resolved', bg: JPColors.successBg, fg: JPColors.success },
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      });
}

export default function ServiceRequestDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [request, setRequest] = useState<ServiceRequestRow | null>(null);
  const [messages, setMessages] = useState<ServiceRequestMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [list, thread] = await Promise.all([
        serviceRequestsApi.listMine({ limit: 200 }),
        serviceRequestsApi.listMessages(id),
      ]);
      setRequest(list.items.find((r) => r.id === id) ?? null);
      setMessages(thread.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this request');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading) {
    return (
      <View style={[styles.root, styles.centered, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ title: 'Request' }} />
        <ActivityIndicator color={JPColors.saffron} />
      </View>
    );
  }

  if (error || !request) {
    return (
      <View style={[styles.root, styles.centered, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ title: 'Request' }} />
        <Text style={styles.errorText}>{error ?? 'Request not found'}</Text>
      </View>
    );
  }

  const meta = STATUS_META[request.status];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: request.category }} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.headerCard}>
          <View style={styles.headerTop}>
            <Text style={styles.category}>{request.category}</Text>
            <View style={[styles.badge, { backgroundColor: meta.bg }]}>
              <Text style={[styles.badgeText, { color: meta.fg }]}>{meta.label}</Text>
            </View>
          </View>
          <Text style={styles.description}>{request.description}</Text>
          <Text style={styles.metaLine}>Raised {fmtDateTime(request.created_at)}</Text>
        </View>

        <Text style={styles.threadTitle}>Conversation</Text>
        {messages.length === 0 ? (
          <Text style={styles.subtle}>
            No replies yet. Our team will respond here — you'll get a notification.
          </Text>
        ) : (
          <View style={styles.thread}>
            {messages.map((m) => {
              const mine = !!user && m.author_user_id === user.id;
              return (
                <View
                  key={m.id}
                  style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}
                >
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={[styles.author, mine && styles.authorMine]}>
                      {mine ? 'You' : 'Support team'}
                    </Text>
                    <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
                      {m.message}
                    </Text>
                    <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
                      {fmtDateTime(m.created_at)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream },
  centered: { alignItems: 'center', justifyContent: 'center' },
  body: { padding: JPSpacing.sp4, gap: JPSpacing.sp3 },
  errorText: { color: JPColors.error, fontFamily: JPFonts.body, fontSize: 14 },
  subtle: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 13, lineHeight: 20 },
  headerCard: {
    backgroundColor: '#FFFFFF',
    borderColor: JPColors.border,
    borderWidth: 1,
    borderRadius: JPRadius.lg,
    padding: JPSpacing.sp4,
    gap: JPSpacing.sp2,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  category: { color: JPColors.textPrimary, fontFamily: JPFonts.display, fontSize: 18 },
  badge: { paddingHorizontal: JPSpacing.sp2, paddingVertical: 2, borderRadius: JPRadius.sm },
  badgeText: { fontFamily: JPFonts.body, fontSize: 11, fontWeight: '700' },
  description: {
    color: JPColors.textPrimary,
    fontFamily: JPFonts.body,
    fontSize: 14,
    lineHeight: 20,
  },
  metaLine: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 11 },
  threadTitle: {
    color: JPColors.textPrimary,
    fontFamily: JPFonts.body,
    fontWeight: '700',
    fontSize: 15,
    marginTop: JPSpacing.sp2,
  },
  thread: { gap: JPSpacing.sp2 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '85%', borderRadius: JPRadius.md, padding: JPSpacing.sp3, gap: 3 },
  bubbleMine: { backgroundColor: JPColors.saffron },
  bubbleTheirs: {
    backgroundColor: '#FFFFFF',
    borderColor: JPColors.border,
    borderWidth: 1,
  },
  author: { fontFamily: JPFonts.body, fontSize: 11, fontWeight: '700', color: JPColors.textSub },
  authorMine: { color: 'rgba(255,255,255,0.9)' },
  bubbleText: {
    fontFamily: JPFonts.body,
    fontSize: 14,
    color: JPColors.textPrimary,
    lineHeight: 20,
  },
  bubbleTextMine: { color: '#FFFFFF' },
  bubbleTime: { fontFamily: JPFonts.body, fontSize: 10, color: JPColors.textSub },
  bubbleTimeMine: { color: 'rgba(255,255,255,0.8)' },
});
