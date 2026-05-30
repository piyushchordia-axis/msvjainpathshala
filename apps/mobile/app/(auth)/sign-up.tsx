/**
 * Mobile sign-up / enrol-a-child flow.
 *
 *   - phone (+91, 10 digits)
 *   - parent name
 *   - child name
 *   - dob (YYYY-MM-DD)
 *   - state → city → centre → batch cascading pickers (replaces the old
 *     paste-a-UUID inputs). State/city come from the public geography API;
 *     centres/batches from the public enrolment-options API. The selected
 *     batch sets the age group automatically.
 *
 * Submitting calls the @Public `POST /v1/enrolments`. Works for guests and
 * for authenticated parents adding another child (the options endpoints are
 * public, so a parent with no centre scope can still browse).
 */

import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import {
  enrolmentOptionsApi,
  type PublicBatch,
  type PublicCentre,
} from '@/api/endpoints/enrolment-options';
import { geographyApi, type CityDto, type StateDto } from '@/api/endpoints/geography';
import { enrolmentsApi } from '@/api/endpoints/students';
import { PrimaryButton } from '@/components/ui';
import { appToast } from '@/components/ui/feedback/AppToast';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

type AgeGroup = 'bal' | 'kishor' | 'tarun' | 'yuva';

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

interface Option {
  id: string;
  label: string;
  sublabel?: string | null;
}

function SelectList({
  label,
  options,
  selectedId,
  onSelect,
  loading,
  placeholder,
  disabled,
}: {
  label: string;
  options: Option[];
  selectedId: string;
  onSelect: (id: string) => void;
  loading?: boolean;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      {disabled ? (
        <Text style={styles.pickerHint}>{placeholder}</Text>
      ) : loading ? (
        <View style={styles.pickerLoading}>
          <ActivityIndicator color={JPColors.saffron} />
        </View>
      ) : options.length === 0 ? (
        <Text style={styles.pickerHint}>Nothing available here yet.</Text>
      ) : (
        <View style={styles.optionList}>
          {options.map((o) => {
            const active = o.id === selectedId;
            return (
              <Pressable
                key={o.id}
                onPress={() => onSelect(o.id)}
                style={[styles.optionRow, active && styles.optionRowActive]}
              >
                <Text style={[styles.optionText, active && styles.optionTextActive]}>
                  {o.label}
                </Text>
                {o.sublabel ? <Text style={styles.optionSub}>{o.sublabel}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

export default function SignUpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Cascading picker state.
  const [states, setStates] = useState<StateDto[]>([]);
  const [cities, setCities] = useState<CityDto[]>([]);
  const [centres, setCentres] = useState<PublicCentre[]>([]);
  const [batchOpts, setBatchOpts] = useState<PublicBatch[]>([]);
  const [stateId, setStateId] = useState('');
  const [cityId, setCityId] = useState('');
  const [loading, setLoading] = useState<'states' | 'cities' | 'centres' | 'batches' | null>(
    'states',
  );

  const set = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((prev) => ({ ...prev, [k]: v }));
  }, []);

  // Load states on mount.
  useEffect(() => {
    let active = true;
    setLoading('states');
    geographyApi
      .states()
      .then((res) => {
        if (active) setStates(res.items);
      })
      .catch(() => appToast.error('Could not load states', 'Check your connection and retry.'))
      .finally(() => {
        if (active) setLoading(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectState = useCallback(async (id: string) => {
    setStateId(id);
    setCityId('');
    setCities([]);
    setCentres([]);
    setBatchOpts([]);
    setForm((p) => ({ ...p, centreId: '', batchId: '' }));
    setLoading('cities');
    try {
      const res = await geographyApi.cities(id);
      setCities(res.items);
    } catch {
      appToast.error('Could not load cities', 'Please try again.');
    } finally {
      setLoading(null);
    }
  }, []);

  const selectCity = useCallback(async (id: string) => {
    setCityId(id);
    setCentres([]);
    setBatchOpts([]);
    setForm((p) => ({ ...p, centreId: '', batchId: '' }));
    setLoading('centres');
    try {
      const res = await enrolmentOptionsApi.centres(id);
      setCentres(res.items);
    } catch {
      appToast.error('Could not load centres', 'Please try again.');
    } finally {
      setLoading(null);
    }
  }, []);

  const selectCentre = useCallback(async (id: string) => {
    setBatchOpts([]);
    setForm((p) => ({ ...p, centreId: id, batchId: '' }));
    setLoading('batches');
    try {
      const res = await enrolmentOptionsApi.batches(id);
      setBatchOpts(res.items);
    } catch {
      appToast.error('Could not load batches', 'Please try again.');
    } finally {
      setLoading(null);
    }
  }, []);

  const selectBatch = useCallback(
    (id: string) => {
      const b = batchOpts.find((x) => x.id === id);
      setForm((p) => ({ ...p, batchId: id, ageGroup: b?.age_group ?? p.ageGroup }));
    },
    [batchOpts],
  );

  const valid =
    isE164Phone(form.phone) &&
    form.parentName.trim().length > 0 &&
    form.childName.trim().length > 0 &&
    isIsoDate(form.dob) &&
    form.centreId.length > 0 &&
    form.batchId.length > 0;

  const submit = useCallback(async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await enrolmentsApi.submit({
        parent_phone: `+91${form.phone}`,
        parent_full_name: form.parentName.trim(),
        preferred_language: 'en',
        requested_centre_id: form.centreId,
        requested_batch_id: form.batchId,
        full_name: form.childName.trim(),
        dob: form.dob,
        age_group: form.ageGroup,
      });
      appToast.success('Enrolment submitted', 'Your Sanchalak will review it shortly.');
      setDone(true);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === 'ERR_VALIDATION_FAILED'
            ? 'Please double-check the form fields.'
            : err.message
          : 'Could not submit. Please try again.';
      setError(msg);
      appToast.error('Could not submit', msg);
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

          <SelectList
            label="State"
            placeholder="Loading…"
            loading={loading === 'states'}
            options={states.map((s) => ({ id: s.id, label: s.name }))}
            selectedId={stateId}
            onSelect={(id) => void selectState(id)}
          />

          <SelectList
            label="City"
            placeholder="Pick a state first"
            disabled={!stateId}
            loading={loading === 'cities'}
            options={cities.map((c) => ({ id: c.id, label: c.name }))}
            selectedId={cityId}
            onSelect={(id) => void selectCity(id)}
          />

          <SelectList
            label="Centre"
            placeholder="Pick a city first"
            disabled={!cityId}
            loading={loading === 'centres'}
            options={centres.map((c) => ({ id: c.id, label: c.name, sublabel: c.locality }))}
            selectedId={form.centreId}
            onSelect={(id) => void selectCentre(id)}
          />

          <SelectList
            label="Batch"
            placeholder="Pick a centre first"
            disabled={!form.centreId}
            loading={loading === 'batches'}
            options={batchOpts.map((b) => ({
              id: b.id,
              label: b.name,
              sublabel: `Age group: ${b.age_group}`,
            }))}
            selectedId={form.batchId}
            onSelect={selectBatch}
          />

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
  optionList: { gap: JPSpacing.sp2 },
  optionRow: {
    borderWidth: 1,
    borderColor: JPColors.border,
    borderRadius: JPRadius.md,
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: JPSpacing.sp3,
    backgroundColor: '#FFFFFF',
  },
  optionRowActive: {
    borderColor: JPColors.saffron,
    backgroundColor: JPColors.saffron50,
  },
  optionText: {
    fontFamily: JPFonts.body,
    fontSize: 15,
    color: JPColors.textPrimary,
  },
  optionTextActive: { color: JPColors.saffron, fontWeight: '600' },
  optionSub: {
    fontFamily: JPFonts.body,
    fontSize: 12,
    color: JPColors.textSub,
    marginTop: 2,
  },
  pickerHint: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    color: JPColors.textSub,
    paddingVertical: JPSpacing.sp2,
  },
  pickerLoading: { paddingVertical: JPSpacing.sp3, alignItems: 'flex-start' },
  error: {
    fontFamily: JPFonts.body,
    color: JPColors.error,
    fontSize: 13,
  },
  cta: { marginTop: JPSpacing.sp3 },
});
