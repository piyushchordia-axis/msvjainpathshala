/**
 * Shikshak → Create a niyam (SPEC §6.10). POST /v1/admin/niyams.
 *
 * Captures the bilingual title, type (daily/weekly/monthly), start/end dates,
 * proof requirement, Punya points, and audience. The server binds the niyam
 * to the shikshak's scope. Audience defaults to "all" (everyone in scope);
 * an MSV-only toggle flips audience_kind to msv_only.
 */

import { Stack, useRouter } from 'expo-router';
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
import { niyamsApi, type NiyamType, type ProofType } from '@/api/endpoints/niyams';
import { appToast } from '@/components/ui/feedback/AppToast';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

const NIYAM_TYPES: NiyamType[] = ['daily', 'weekly', 'monthly'];
const PROOF_TYPES: ProofType[] = ['photo', 'video', 'either'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewNiyamScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [titleEn, setTitleEn] = useState('');
  const [titleHi, setTitleHi] = useState('');
  const [descEn, setDescEn] = useState('');
  const [type, setType] = useState<NiyamType>('daily');
  const [proofType, setProofType] = useState<ProofType>('photo');
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState('');
  const [points, setPoints] = useState('10');
  const [msvOnly, setMsvOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (titleEn.trim().length < 2 || titleHi.trim().length < 2) {
      appToast.error('Add both titles', 'English and Hindi titles are required.');
      return;
    }
    if (!DATE_RE.test(startDate)) {
      appToast.error('Check start date', 'Use the format YYYY-MM-DD.');
      return;
    }
    if (endDate && !DATE_RE.test(endDate)) {
      appToast.error('Check end date', 'Use the format YYYY-MM-DD or leave it blank.');
      return;
    }
    const pts = Number(points);
    if (!Number.isInteger(pts) || pts < 1 || pts > 200) {
      appToast.error('Check Punya points', 'Enter a whole number between 1 and 200.');
      return;
    }
    setBusy(true);
    try {
      await niyamsApi.create({
        title_en: titleEn.trim(),
        title_hi: titleHi.trim(),
        ...(descEn.trim() ? { description_en: descEn.trim() } : {}),
        type,
        start_date: startDate,
        ...(endDate ? { end_date: endDate } : {}),
        audience_kind: msvOnly ? 'msv_only' : 'all',
        audience_filters: null,
        proof_type: proofType,
        points_value: pts,
        msv_only: msvOnly,
      });
      appToast.success('Niyam created', 'It is now live for students in your scope.');
      router.back();
    } catch (err) {
      appToast.error(
        'Could not create',
        err instanceof ApiError ? err.message : 'Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'New niyam' }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Field label="Title (English)">
          <TextInput
            style={styles.input}
            value={titleEn}
            onChangeText={setTitleEn}
            placeholder="e.g. Morning Navkar"
            placeholderTextColor={JPColors.textSub}
            editable={!busy}
            maxLength={140}
          />
        </Field>
        <Field label="शीर्षक (हिन्दी)">
          <TextInput
            style={styles.input}
            value={titleHi}
            onChangeText={setTitleHi}
            placeholder="जैसे, प्रातः नवकार"
            placeholderTextColor={JPColors.textSub}
            editable={!busy}
            maxLength={140}
          />
        </Field>
        <Field label="Description (optional)">
          <TextInput
            style={[styles.input, styles.textArea]}
            value={descEn}
            onChangeText={setDescEn}
            placeholder="What should the student do?"
            placeholderTextColor={JPColors.textSub}
            editable={!busy}
            multiline
            maxLength={1000}
            textAlignVertical="top"
          />
        </Field>

        <Field label="How often?">
          <ChipRow
            options={NIYAM_TYPES}
            value={type}
            onChange={setType}
            labels={{ daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }}
          />
        </Field>

        <Field label="Proof required">
          <ChipRow
            options={PROOF_TYPES}
            value={proofType}
            onChange={setProofType}
            labels={{ photo: 'Photo', video: 'Video', either: 'Either' }}
          />
        </Field>

        <View style={styles.dateRow}>
          <View style={styles.dateCol}>
            <Field label="Starts">
              <TextInput
                style={styles.input}
                value={startDate}
                onChangeText={setStartDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={JPColors.textSub}
                editable={!busy}
                autoCapitalize="none"
              />
            </Field>
          </View>
          <View style={styles.dateCol}>
            <Field label="Ends (optional)">
              <TextInput
                style={styles.input}
                value={endDate}
                onChangeText={setEndDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={JPColors.textSub}
                editable={!busy}
                autoCapitalize="none"
              />
            </Field>
          </View>
        </View>

        <Field label="Punya points">
          <TextInput
            style={styles.input}
            value={points}
            onChangeText={setPoints}
            placeholder="10"
            placeholderTextColor={JPColors.textSub}
            editable={!busy}
            keyboardType="number-pad"
            maxLength={3}
          />
        </Field>

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>MSV only</Text>
            <Text style={styles.switchHint}>Only MSV-enrolled students see this niyam.</Text>
          </View>
          <Switch
            value={msvOnly}
            onValueChange={setMsvOnly}
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
            <Text style={styles.submitText}>Create niyam</Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function ChipRow<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((o) => {
        const active = o === value;
        return (
          <Pressable
            key={o}
            onPress={() => onChange(o)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{labels[o]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream },
  body: { padding: JPSpacing.sp4, gap: JPSpacing.sp3 },
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
  textArea: { minHeight: 90 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: JPSpacing.sp2 },
  chip: {
    backgroundColor: '#FFFFFF',
    borderColor: JPColors.border,
    borderWidth: 1,
    paddingVertical: JPSpacing.sp2,
    paddingHorizontal: JPSpacing.sp3,
    borderRadius: JPRadius.pill,
  },
  chipActive: { backgroundColor: JPColors.saffron, borderColor: JPColors.saffron },
  chipText: { color: JPColors.textPrimary, fontFamily: JPFonts.body, fontSize: 13 },
  chipTextActive: { color: '#FFFFFF', fontWeight: '700' },
  dateRow: { flexDirection: 'row', gap: JPSpacing.sp3 },
  dateCol: { flex: 1 },
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
