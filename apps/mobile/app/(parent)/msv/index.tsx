/**
 * Parent → Apply for MSV (Step 10, Q1).
 *
 * Lists the parent's active children with their current MSV status. A child
 * with status 'none' / 'rejected' / 'revoked' can apply; an in-progress
 * ('applied' / 'waitlisted') or 'approved' child shows a status pill instead.
 *
 * POST /v1/msv/enrolments { student_id, note? } — matches msvApplicationSchema
 * exactly. Q1: no eligibility checks — the note just captures intent.
 */

import { Stack, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { msvApi, type MsvStatus } from '@/api/endpoints/msv';
import { studentsApi, type StudentDto } from '@/api/endpoints/students';
import { appToast } from '@/components/ui/feedback/AppToast';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

const STATUS_META: Record<MsvStatus, { label: string; bg: string; fg: string }> = {
  none: { label: 'Not applied', bg: JPColors.creamDeeper, fg: JPColors.textSub },
  applied: { label: 'Applied', bg: JPColors.warningBg, fg: JPColors.warning },
  waitlisted: { label: 'Waitlisted', bg: JPColors.warningBg, fg: JPColors.warning },
  approved: { label: 'Approved', bg: JPColors.gold50, fg: JPColors.gold },
  rejected: { label: 'Not selected', bg: JPColors.errorBg, fg: JPColors.error },
  revoked: { label: 'Revoked', bg: JPColors.errorBg, fg: JPColors.error },
};

const CAN_APPLY: MsvStatus[] = ['none', 'rejected', 'revoked'];

export default function MsvApplyScreen() {
  const insets = useSafeAreaInsets();
  const [children, setChildren] = useState<StudentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await studentsApi.myChildren();
      setChildren(res.items.filter((s) => s.status === 'active'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your children');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function submit(studentId: string): Promise<void> {
    setBusy(true);
    try {
      await msvApi.apply({
        student_id: studentId,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      appToast.success('Application sent', 'Your MSV application is now with the admin.');
      setOpenFor(null);
      setNote('');
      await load();
    } catch (err) {
      appToast.error(
        'Could not apply',
        err instanceof ApiError ? err.message : 'Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'MSV programme' }} />
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
      ) : children.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.subtle}>Add a child first to apply for the MSV programme.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.intro}>
            The Megh Sanskar Vatika programme is a deeper track of Jain learning. Applications are
            reviewed by the admin team.
          </Text>
          {children.map((c) => {
            const status = (c.msv_status ?? 'none') as MsvStatus;
            const meta = STATUS_META[status];
            const canApply = CAN_APPLY.includes(status);
            const open = openFor === c.id;
            return (
              <View key={c.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={styles.childName}>{c.full_name}</Text>
                  <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                    <Text style={[styles.badgeText, { color: meta.fg }]}>{meta.label}</Text>
                  </View>
                </View>

                {canApply && !open ? (
                  <Pressable
                    style={styles.applyBtn}
                    onPress={() => {
                      setOpenFor(c.id);
                      setNote('');
                    }}
                  >
                    <Text style={styles.applyBtnText}>Apply for MSV</Text>
                  </Pressable>
                ) : null}

                {!canApply ? (
                  <Text style={styles.statusNote}>
                    {status === 'approved'
                      ? 'This child is enrolled in the MSV programme.'
                      : 'An application is in progress — the admin will update you.'}
                  </Text>
                ) : null}

                {open ? (
                  <View style={styles.form}>
                    <Text style={styles.label}>
                      Why are you applying for your child? (optional)
                    </Text>
                    <TextInput
                      style={styles.textArea}
                      value={note}
                      onChangeText={setNote}
                      placeholder="Share your child's motivation and anything the admin should know…"
                      placeholderTextColor={JPColors.textSub}
                      multiline
                      maxLength={1000}
                      textAlignVertical="top"
                      editable={!busy}
                    />
                    <View style={styles.formActions}>
                      <Pressable
                        style={styles.cancelBtn}
                        onPress={() => setOpenFor(null)}
                        disabled={busy}
                      >
                        <Text style={styles.cancelText}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.submitBtn, busy && styles.submitBtnDisabled]}
                        onPress={() => void submit(c.id)}
                        disabled={busy}
                      >
                        {busy ? (
                          <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                          <Text style={styles.submitText}>Submit application</Text>
                        )}
                      </Pressable>
                    </View>
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
  intro: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 13, lineHeight: 20 },
  subtle: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 14, textAlign: 'center' },
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
  childName: {
    color: JPColors.textPrimary,
    fontFamily: JPFonts.body,
    fontWeight: '700',
    fontSize: 16,
  },
  badge: { paddingHorizontal: JPSpacing.sp2, paddingVertical: 2, borderRadius: JPRadius.sm },
  badgeText: { fontFamily: JPFonts.body, fontSize: 11, fontWeight: '700' },
  applyBtn: {
    backgroundColor: JPColors.saffron,
    paddingVertical: JPSpacing.sp3,
    borderRadius: JPRadius.md,
    alignItems: 'center',
  },
  applyBtnText: { color: '#FFFFFF', fontFamily: JPFonts.body, fontWeight: '700' },
  statusNote: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 13, lineHeight: 19 },
  form: { gap: JPSpacing.sp2 },
  label: { color: JPColors.textPrimary, fontFamily: JPFonts.body, fontWeight: '600', fontSize: 13 },
  textArea: {
    backgroundColor: JPColors.cream,
    borderColor: JPColors.border,
    borderWidth: 1,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
    minHeight: 80,
    color: JPColors.textPrimary,
    fontFamily: JPFonts.body,
    fontSize: 14,
  },
  formActions: { flexDirection: 'row', gap: JPSpacing.sp3, marginTop: JPSpacing.sp2 },
  cancelBtn: {
    flex: 1,
    paddingVertical: JPSpacing.sp3,
    borderRadius: JPRadius.md,
    alignItems: 'center',
    borderColor: JPColors.border,
    borderWidth: 1,
  },
  cancelText: { color: JPColors.textPrimary, fontFamily: JPFonts.body, fontWeight: '600' },
  submitBtn: {
    flex: 2,
    backgroundColor: JPColors.saffron,
    paddingVertical: JPSpacing.sp3,
    borderRadius: JPRadius.md,
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { color: '#FFFFFF', fontFamily: JPFonts.body, fontWeight: '700' },
});
