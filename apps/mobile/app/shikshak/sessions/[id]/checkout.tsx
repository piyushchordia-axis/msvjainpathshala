/**
 * Check-out — final tap after marking attendance.
 *
 * Captures a fresh GPS fix and POSTs to /v1/sessions/:id/check-out.
 * Layout mirrors the gps-session.html "session active" card.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ulid } from 'ulid';

import { Header } from '@/components/ui';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';
import { attendanceApi } from '@/features/attendance/attendance.api';
import { getCurrentPosition, type GpsFix } from '@/location/gps';

export default function CheckoutScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const sessionId = params.id!;
  const [fix, setFix] = useState<GpsFix | null>(null);
  const [capturing, setCapturing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void captureGps();
  }, []);

  async function captureGps() {
    setCapturing(true);
    setError(null);
    try {
      const next = await getCurrentPosition({ minAccuracyM: 100 });
      setFix(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not capture GPS.');
    } finally {
      setCapturing(false);
    }
  }

  async function submit() {
    if (!fix) return;
    setSubmitting(true);
    setError(null);
    try {
      await attendanceApi.checkOut(sessionId, {
        lat: fix.lat,
        lng: fix.lng,
        client_op_id: ulid(),
      });
      setDone(true);
      setTimeout(() => router.replace('/(tabs)/shikshak/today' as never), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check out.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Header title="Check out" subtitle="End the session" />
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Session summary</Text>
          {capturing ? (
            <ActivityIndicator color={JPColors.saffron} style={{ marginTop: 12 }} />
          ) : fix ? (
            <>
              <Text style={styles.coords}>
                {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)} (±{fix.accuracy_m}m)
              </Text>
            </>
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}
        </View>

        {done ? (
          <View style={styles.successBanner}>
            <Text style={styles.successText}>Session completed</Text>
          </View>
        ) : null}

        <Pressable
          disabled={!fix || submitting || done}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.primaryBtn,
            (!fix || submitting || done) && styles.primaryBtnDisabled,
            pressed && { opacity: 0.92 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryBtnText}>Check out</Text>
          )}
        </Pressable>
        <Pressable onPress={() => void captureGps()} style={styles.secondaryBtn}>
          <Text style={styles.secondaryBtnText}>Retry GPS</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream },
  content: { padding: JPSpacing.sp4, flex: 1 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.lg,
    padding: JPSpacing.sp4,
    borderColor: JPColors.creamDeeper,
    borderWidth: 1,
  },
  cardTitle: {
    fontFamily: JPFonts.body,
    fontWeight: '700',
    fontSize: 15,
    color: JPColors.textPrimary,
    marginBottom: 8,
  },
  coords: {
    fontFamily: JPFonts.mono,
    fontSize: 13,
    color: JPColors.textSub,
  },
  errorText: {
    color: JPColors.error,
    fontFamily: JPFonts.body,
    fontWeight: '500',
    fontSize: 13,
  },
  successBanner: {
    marginTop: JPSpacing.sp3,
    backgroundColor: JPColors.successBg,
    padding: JPSpacing.sp3,
    borderRadius: JPRadius.md,
    alignItems: 'center',
  },
  successText: {
    color: JPColors.success,
    fontFamily: JPFonts.body,
    fontWeight: '700',
  },
  primaryBtn: {
    marginTop: JPSpacing.sp4,
    backgroundColor: JPColors.saffron,
    paddingVertical: 14,
    borderRadius: JPRadius.md,
    alignItems: 'center',
  },
  primaryBtnDisabled: {
    backgroundColor: JPColors.saffron300,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontFamily: JPFonts.body,
    fontWeight: '700',
    fontSize: 16,
  },
  secondaryBtn: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 12,
  },
  secondaryBtnText: {
    color: JPColors.textSub,
    fontFamily: JPFonts.body,
    fontWeight: '500',
  },
});
