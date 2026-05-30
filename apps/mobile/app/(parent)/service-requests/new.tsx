/**
 * Parent → raise a new service request (SPEC §6.19).
 * POST /v1/service-requests { category, description, student_id? }.
 *
 * A student_id routes the request to that child's centre sanchalak; omitting
 * it routes to the city_admin pool (server-side, see ServiceRequestsService).
 */

import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
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
import { serviceRequestsApi } from '@/api/endpoints/service-requests';
import { studentsApi, type StudentDto } from '@/api/endpoints/students';
import { PrimaryButton } from '@/components/ui';
import { appToast } from '@/components/ui/feedback/AppToast';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

const CATEGORIES = [
  'Attendance',
  'Fees & payments',
  'Batch transfer',
  'Timings',
  'Curriculum',
  'Other',
];

export default function NewServiceRequestScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [children, setChildren] = useState<StudentDto[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadChildren = useCallback(async () => {
    try {
      const res = await studentsApi.myChildren();
      setChildren(res.items.filter((s) => s.status === 'active'));
    } catch {
      setChildren([]);
    }
  }, []);

  useEffect(() => {
    void loadChildren();
  }, [loadChildren]);

  async function submit(): Promise<void> {
    const trimmed = description.trim();
    if (trimmed.length < 2) {
      appToast.error('Add a description', 'Tell us a little about your request.');
      return;
    }
    setBusy(true);
    try {
      await serviceRequestsApi.create({
        category,
        description: trimmed,
        ...(studentId ? { student_id: studentId } : {}),
      });
      appToast.success('Request sent', 'Our team will get back to you soon.');
      router.back();
    } catch (err) {
      appToast.error('Could not send', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'New request' }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.label}>What is this about?</Text>
        <View style={styles.chipRow}>
          {CATEGORIES.map((c) => {
            const active = c === category;
            return (
              <Pressable
                key={c}
                onPress={() => setCategory(c)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c}</Text>
              </Pressable>
            );
          })}
        </View>

        {children.length > 0 ? (
          <>
            <Text style={styles.label}>Which child? (optional)</Text>
            <View style={styles.chipRow}>
              <Pressable
                onPress={() => setStudentId(null)}
                style={[styles.chip, studentId === null && styles.chipActive]}
              >
                <Text style={[styles.chipText, studentId === null && styles.chipTextActive]}>
                  General
                </Text>
              </Pressable>
              {children.map((c) => {
                const active = c.id === studentId;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setStudentId(c.id)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {c.full_name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>Describe your request</Text>
        <TextInput
          style={styles.textArea}
          value={description}
          onChangeText={setDescription}
          placeholder="Type the details here…"
          placeholderTextColor={JPColors.textSub}
          multiline
          numberOfLines={6}
          textAlignVertical="top"
          maxLength={4000}
          editable={!busy}
        />

        <View style={styles.cta}>
          {busy ? (
            <ActivityIndicator color={JPColors.saffron} />
          ) : (
            <PrimaryButton onPress={() => void submit()}>Send request</PrimaryButton>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream },
  body: { padding: JPSpacing.sp4, gap: JPSpacing.sp3 },
  label: {
    color: JPColors.textPrimary,
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 15,
    marginTop: JPSpacing.sp2,
  },
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
  textArea: {
    backgroundColor: '#FFFFFF',
    borderColor: JPColors.border,
    borderWidth: 1,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
    minHeight: 140,
    color: JPColors.textPrimary,
    fontFamily: JPFonts.body,
    fontSize: 14,
  },
  cta: { marginTop: JPSpacing.sp4, alignItems: 'center' },
});
