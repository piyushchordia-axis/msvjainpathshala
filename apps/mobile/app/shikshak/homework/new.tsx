/**
 * Shikshak → Assign homework (SPEC §6.12). POST /v1/admin/homework.
 *
 * Reached from the batches tab with batchId + batchName route params, so the
 * teacher assigns directly to a known batch. Captures title, optional
 * description, a due date, and an MSV-only flag. The server scopes the write
 * to the teacher's batches.
 */

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { homeworkApi } from '@/api/endpoints/homework';
import { appToast } from '@/components/ui/feedback/AppToast';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function NewHomeworkScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { batchId, batchName } = useLocalSearchParams<{ batchId: string; batchName?: string }>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isMsv, setIsMsv] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (!batchId) {
      appToast.error('No batch selected', 'Open this from a batch to assign homework.');
      return;
    }
    if (title.trim().length < 2) {
      appToast.error('Add a title', 'Give the homework a short title.');
      return;
    }
    if (!DATE_RE.test(dueDate)) {
      appToast.error('Check the due date', 'Use the format YYYY-MM-DD.');
      return;
    }
    setBusy(true);
    try {
      await homeworkApi.create({
        batch_id: batchId,
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        due_date: dueDate,
        is_msv: isMsv,
      });
      appToast.success('Homework assigned', 'Students in this batch can see it now.');
      router.back();
    } catch (err) {
      appToast.error(
        'Could not assign',
        err instanceof ApiError ? err.message : 'Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'Assign homework' }} />
      <ScrollView contentContainerStyle={styles.body}>
        {batchName ? <Text style={styles.batchLine}>For batch: {batchName}</Text> : null}

        <View style={styles.field}>
          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Learn the Navkar Mantra"
            placeholderTextColor={JPColors.textSub}
            editable={!busy}
            maxLength={140}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Details (optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Instructions for the students…"
            placeholderTextColor={JPColors.textSub}
            editable={!busy}
            multiline
            maxLength={2000}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Due date</Text>
          <TextInput
            style={styles.input}
            value={dueDate}
            onChangeText={setDueDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={JPColors.textSub}
            editable={!busy}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>MSV only</Text>
            <Text style={styles.switchHint}>Only MSV-enrolled students see this homework.</Text>
          </View>
          <Switch
            value={isMsv}
            onValueChange={setIsMsv}
            disabled={busy}
            trackColor={{ true: JPColors.saffron, false: JPColors.creamDeeper }}
          />
        </View>

        <Pressable
          style={[styles.submitBtn, busy && styles.submitBtnDisabled]}
          onPress={() => void submit()}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.submitText}>Assign homework</Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream },
  body: { padding: JPSpacing.sp4, gap: JPSpacing.sp3 },
  batchLine: { color: JPColors.maroon, fontFamily: JPFonts.body, fontWeight: '600', fontSize: 14 },
  field: { gap: JPSpacing.sp2 },
  label: { color: JPColors.textPrimary, fontFamily: JPFonts.body, fontWeight: '600', fontSize: 14 },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: JPColors.border,
    borderWidth: 1,
    borderRadius: JPRadius.md,
    paddingHorizontal: JPSpacing.sp3,
    paddingVertical: JPSpacing.sp3,
    color: JPColors.textPrimary,
    fontFamily: JPFonts.body,
    fontSize: 14,
  },
  textArea: { minHeight: 100 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: JPSpacing.sp3,
    backgroundColor: '#FFFFFF',
    borderColor: JPColors.border,
    borderWidth: 1,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
  },
  switchLabel: {
    color: JPColors.textPrimary,
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 14,
  },
  switchHint: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 12, marginTop: 2 },
  submitBtn: {
    backgroundColor: JPColors.saffron,
    paddingVertical: JPSpacing.sp4,
    borderRadius: JPRadius.md,
    alignItems: 'center',
    marginTop: JPSpacing.sp2,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { color: '#FFFFFF', fontFamily: JPFonts.body, fontWeight: '700', fontSize: 15 },
});
