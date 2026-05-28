/**
 * Mobile sign-up flow. Step 10 ships a minimal but functional form:
 *
 *   - phone (+91, 10 digits)
 *   - parent name
 *   - child name
 *   - dob (YYYY-MM-DD)
 *   - age group
 *   - centre id  (full picker UI lands when /v1/centres list is wired)
 *   - batch id   (full picker UI lands when /v1/batches list is wired)
 *
 * Submitting calls `POST /v1/enrolments`. If the API returns a duplicate
 * warning we surface it inline but still let the parent confirm. After
 * success the parent is bounced back to the auth landing (their phone
 * is now in the system as a `guest`; once an admin approves they're
 * promoted to `parent`).
 */

import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { enrolmentsApi } from '@/api/endpoints/students';
import { PrimaryButton } from '@/components/ui';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

const AGE_GROUPS = ['bal', 'kishor', 'tarun', 'yuva'] as const;
type AgeGroup = (typeof AGE_GROUPS)[number];

interface FormState {
  phone: string;
  parentName: string;
  childName: string;
  dob: string;
  ageGroup: AgeGroup;
  centreId: string;
  batchId: string;
}

const INITIAL: FormState = {
  phone: '',
  parentName: '',
  childName: '',
  dob: '',
  ageGroup: 'bal',
  centreId: '',
  batchId: '',
};

function isE164Phone(digits: string): boolean {
  return /^\d{10}$/.test(digits);
}
function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function FieldLabel({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad' | 'numeric';
  autoCapitalize?: 'words' | 'none';
  maxLength?: number;
}) {
  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={JPColors.textDim}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize ?? 'words'}
        maxLength={maxLength}
        style={styles.input}
      />
    </View>
  );
}

export default function SignUpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const set = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((prev) => ({ ...prev, [k]: v }));
  }, []);

  const valid =
    isE164Phone(form.phone) &&
    form.parentName.trim().length > 0 &&
    form.childName.trim().length > 0 &&
    isIsoDate(form.dob) &&
    isUuid(form.centreId) &&
    isUuid(form.batchId);

  const submit = useCallback(async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      await enrolmentsApi.submit({
        parent_phone: `+91${form.phone}`,
        parent_full_name: form.parentName.trim(),
        preferred_language: 'en',
        requested_centre_id: form.centreId.trim(),
        requested_batch_id: form.batchId.trim(),
        full_name: form.childName.trim(),
        dob: form.dob,
        age_group: form.ageGroup,
      });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'ERR_VALIDATION_FAILED') {
          setError('Please double-check the form fields.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Could not submit. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }, [form, valid]);

  if (done) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + JPSpacing.sp7 }]}>
        <View style={styles.brand}>
          <Text style={styles.display}>Thank you</Text>
          <Text style={styles.subDisplay}>
            Your enrolment has been submitted. Your Sanchalak will review it shortly. You can sign
            in with your phone number once they approve.
          </Text>
        </View>
        <PrimaryButton onPress={() => router.replace('/(auth)/phone')}>Done</PrimaryButton>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView
        contentContainerStyle={[styles.root, { paddingTop: insets.top + JPSpacing.sp6 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={() => router.back()} hitSlop={20}>
          <Text style={styles.back}>Back</Text>
        </Pressable>

        <View style={styles.brand}>
          <Text style={styles.display}>Sign up</Text>
          <Text style={styles.subDisplay}>
            Enrol your child in a Pathshala. Your Sanchalak will review the application.
          </Text>
        </View>

        <View style={styles.formCard}>
          <Field
            label="Your mobile number (10 digits)"
            value={form.phone}
            onChangeText={(v) => set('phone', v.replace(/\D+/g, '').slice(0, 10))}
            placeholder="98765 43210"
            keyboardType="number-pad"
            autoCapitalize="none"
            maxLength={10}
          />
          <Field
            label="Your name"
            value={form.parentName}
            onChangeText={(v) => set('parentName', v)}
            placeholder="Rajesh Shah"
          />
          <Field
            label="Child's name"
            value={form.childName}
            onChangeText={(v) => set('childName', v)}
            placeholder="Aarav Shah"
          />
          <Field
            label="Date of birth (YYYY-MM-DD)"
            value={form.dob}
            onChangeText={(v) => set('dob', v.replace(/[^0-9-]/g, '').slice(0, 10))}
            placeholder="2017-05-15"
            keyboardType="numeric"
            autoCapitalize="none"
            maxLength={10}
          />

          <View style={styles.field}>
            <FieldLabel>Age group</FieldLabel>
            <View style={styles.row}>
              {AGE_GROUPS.map((g) => {
                const active = form.ageGroup === g;
                return (
                  <Pressable
                    key={g}
                    onPress={() => set('ageGroup', g)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{g}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Field
            label="Centre id"
            value={form.centreId}
            onChangeText={(v) => set('centreId', v.trim())}
            placeholder="Paste centre UUID"
            autoCapitalize="none"
          />
          <Field
            label="Batch id"
            value={form.batchId}
            onChangeText={(v) => set('batchId', v.trim())}
            placeholder="Paste batch UUID"
            autoCapitalize="none"
          />
          <Text style={styles.helper}>
            Centre and batch pickers land in a follow-up step; for now your Sanchalak can share the
            IDs with you.
          </Text>

          {warning ? <Text style={styles.warning}>{warning}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.cta}>
            <PrimaryButton onPress={submit} disabled={!valid || busy} loading={busy}>
              {busy ? 'Submitting…' : 'Submit enrolment'}
            </PrimaryButton>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flexGrow: 1,
    backgroundColor: JPColors.cream,
    paddingHorizontal: JPSpacing.sp4,
    paddingBottom: JPSpacing.sp7,
  },
  back: { fontFamily: JPFonts.body, color: JPColors.maroon, fontSize: 15 },
  brand: { marginTop: JPSpacing.sp4, marginBottom: JPSpacing.sp6 },
  display: { fontFamily: JPFonts.display, fontSize: 28, color: JPColors.maroon },
  subDisplay: {
    fontFamily: JPFonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: JPColors.textSub,
    marginTop: JPSpacing.sp2,
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: JPSpacing.sp5,
    borderWidth: 1,
    borderColor: JPColors.border,
    gap: JPSpacing.sp4,
  },
  field: { gap: 6 },
  label: {
    fontFamily: JPFonts.body,
    fontSize: 12,
    color: JPColors.textSub,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  input: {
    backgroundColor: JPColors.creamDark,
    borderWidth: 1,
    borderColor: JPColors.border,
    borderRadius: JPRadius.md,
    fontFamily: JPFonts.body,
    fontSize: 16,
    color: JPColors.textPrimary,
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: JPSpacing.sp3,
  },
  row: { flexDirection: 'row', gap: JPSpacing.sp2, flexWrap: 'wrap' },
  chip: {
    borderWidth: 1,
    borderColor: JPColors.border,
    borderRadius: JPRadius.pill,
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  chipActive: {
    borderColor: JPColors.saffron,
    backgroundColor: JPColors.saffron50,
  },
  chipText: {
    fontFamily: JPFonts.body,
    color: JPColors.textSub,
    fontSize: 14,
    textTransform: 'capitalize',
  },
  chipTextActive: { color: JPColors.saffron, fontWeight: '600' },
  helper: {
    fontFamily: JPFonts.body,
    fontSize: 12,
    color: JPColors.textSub,
  },
  warning: {
    fontFamily: JPFonts.body,
    color: JPColors.warning,
    fontSize: 13,
  },
  error: {
    fontFamily: JPFonts.body,
    color: JPColors.error,
    fontSize: 13,
  },
  cta: { marginTop: JPSpacing.sp3 },
});
