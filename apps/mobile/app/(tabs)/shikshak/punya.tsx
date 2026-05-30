/**
 * Shikshak → Award Punya. Discretionary manual award to a student in the
 * teacher's scope (POST /v1/punya/award, feature_key=manual_award).
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api/client';
import { punyaApi } from '@/api/endpoints/punya';
import { studentsApi, type AdminStudentRow } from '@/api/endpoints/students';
import { DataScreen, Panel } from '@/components/admin/AdminScreen';
import { PrimaryButton } from '@/components/ui';
import { appToast } from '@/components/ui/feedback/AppToast';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

export default function ShikshakPunyaScreen() {
  const [students, setStudents] = useState<AdminStudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [points, setPoints] = useState('10');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await studentsApi.listForAdmin({ status: 'active', limit: 200 });
      setStudents(res.items);
      setStudentId((prev) => prev ?? res.items[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load students.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pointsNum = Number(points);
  const valid =
    !!studentId &&
    Number.isInteger(pointsNum) &&
    pointsNum !== 0 &&
    pointsNum >= -500 &&
    pointsNum <= 500 &&
    reason.trim().length >= 3;

  async function award() {
    if (!valid || !studentId) {
      appToast.error(
        'Check the form',
        'Pick a student, points (−500…500, non-zero) and a reason (3+ characters).',
      );
      return;
    }
    setSaving(true);
    try {
      await punyaApi.award({
        student_id: studentId,
        feature_key: 'manual_award',
        points: pointsNum,
        reason: reason.trim(),
      });
      appToast.success('Punya awarded', `${pointsNum > 0 ? '+' : ''}${pointsNum} points recorded`);
      setReason('');
    } catch (err) {
      appToast.error(
        'Could not award Punya',
        err instanceof ApiError ? err.message : 'Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <DataScreen
      title="Award Punya"
      subtitle="Give discretionary Punya to a student"
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
      empty={students.length === 0}
      emptyTitle="No students"
      emptyBody="No active students in your scope yet."
    >
      <Panel>
        <Text style={styles.label}>Student</Text>
        <View style={styles.options}>
          {students.map((s) => {
            const active = s.id === studentId;
            return (
              <Pressable
                key={s.id}
                onPress={() => setStudentId(s.id)}
                style={[styles.option, active && styles.optionActive]}
              >
                <Text style={[styles.optionText, active && styles.optionTextActive]}>
                  {s.full_name}
                  {s.student_code ? ` · ${s.student_code}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Points</Text>
        <TextInput
          style={styles.input}
          value={points}
          onChangeText={setPoints}
          keyboardType="numbers-and-punctuation"
          placeholder="10"
          placeholderTextColor={JPColors.textDim}
        />

        <Text style={styles.label}>Reason</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={reason}
          onChangeText={setReason}
          placeholder="Why are you awarding this?"
          placeholderTextColor={JPColors.textDim}
          multiline
        />

        <View style={styles.cta}>
          <PrimaryButton onPress={award} loading={saving} disabled={saving || !valid}>
            Award Punya
          </PrimaryButton>
        </View>
      </Panel>
    </DataScreen>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: JPFonts.body,
    fontSize: 12,
    color: JPColors.textSub,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: JPSpacing.sp3,
    marginBottom: 6,
  },
  options: { gap: JPSpacing.sp2 },
  option: {
    borderWidth: 1,
    borderColor: JPColors.border,
    borderRadius: JPRadius.md,
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: JPSpacing.sp3,
    backgroundColor: '#FFFFFF',
  },
  optionActive: { borderColor: JPColors.saffron, backgroundColor: JPColors.saffron50 },
  optionText: { fontFamily: JPFonts.body, fontSize: 15, color: JPColors.textPrimary },
  optionTextActive: { color: JPColors.saffron, fontWeight: '600' },
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
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  cta: { marginTop: JPSpacing.sp4 },
});
