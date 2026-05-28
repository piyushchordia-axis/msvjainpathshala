/**
 * Id-less check-in — entry point when no `sessions` row exists yet.
 *
 * Reads `?batch_id=` from the route, captures GPS, posts to
 * `POST /v1/sessions/check-in`. On success the server returns the newly
 * created session; we then push the mark screen with that id.
 *
 * Matches `jp-design-system/preview/gps-session.html` — saffron CTA,
 * cream background, off-site amber warning banner.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ulid } from 'ulid';

import { Header } from '@/components/ui';
import { JPColors, JPRadius, JPSpacing } from '@/constants/colors';
import { attendanceApi } from '@/features/attendance/attendance.api';
import { getCurrentPosition, type GpsFix } from '@/location/gps';

export default function ShikshakSessionNewCheckin() {
  return <CheckinScreen mode="new" />;
}

export function CheckinScreen({ mode }: { mode: 'new' | 'existing' }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ batch_id?: string; id?: string }>();
  const [fix, setFix] = useState<GpsFix | null>(null);
  const [capturing, setCapturing] = useState(true);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    void captureGps();
  }, []);

  async function captureGps() {
    setCapturing(true);
    setGpsError(null);
    try {
      const next = await getCurrentPosition({ minAccuracyM: 100 });
      setFix(next);
    } catch (err) {
      setGpsError(err instanceof Error ? err.message : 'Could not capture GPS.');
    } finally {
      setCapturing(false);
    }
  }

  async function submitCheckIn() {
    if (!fix) return;
    setSubmitting(true);
    setSubmitError(null);
    const clientOpId = ulid();
    try {
      let sessionId: string;
      if (mode === 'new') {
        if (!params.batch_id) throw new Error('Missing batch_id');
        const res = await attendanceApi.checkInByBatch({
          batch_id: params.batch_id,
          lat: fix.lat,
          lng: fix.lng,
          accuracy_m: fix.accuracy_m,
          client_op_id: clientOpId,
        });
        sessionId = res.session.id;
      } else {
        if (!params.id) throw new Error('Missing session id');
        const res = await attendanceApi.checkInById(params.id, {
          lat: fix.lat,
          lng: fix.lng,
          accuracy_m: fix.accuracy_m,
          client_op_id: clientOpId,
        });
        sessionId = res.session.id;
      }
      router.replace(`/shikshak/sessions/${sessionId}/mark` as never);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not check in.');
    } finally {
      setSubmitting(false);
    }
  }

  const accuracy = fix?.accuracy_m ?? null;
  const isAccurateEnough = accuracy !== null && accuracy <= 100;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Header title="Check in" subtitle="Confirm you are at the centre" />
      <View style={styles.content}>
        <View style={styles.gpsCard}>
          <Text style={styles.gpsLabel}>GPS fix</Text>
          {capturing ? (
            <View style={styles.row}>
              <ActivityIndicator color={JPColors.saffron} />
              <Text style={styles.gpsHint}>Locating you…</Text>
            </View>
          ) : gpsError ? (
            <>
              <Text style={styles.errorText}>{gpsError}</Text>
              <Pressable style={styles.secondaryBtn} onPress={() => void captureGps()}>
                <Text style={styles.secondaryBtnText}>Retry</Text>
              </Pressable>
            </>
          ) : fix ? (
            <>
              <Text style={styles.coords}>
                {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}
              </Text>
              <View style={styles.row}>
                <Text style={styles.accuracyLabel}>Accuracy</Text>
                <Text
                  style={[
                    styles.accuracyValue,
                    { color: isAccurateEnough ? '#166534' : '#B45309' },
                  ]}
                >
                  {fix.accuracy_m} m
                </Text>
              </View>
              <Pressable style={styles.secondaryBtn} onPress={() => void captureGps()}>
                <Text style={styles.secondaryBtnText}>Get a better fix</Text>
              </Pressable>
            </>
          ) : null}
        </View>

        {accuracy !== null && accuracy > 50 && accuracy <= 100 ? (
          <View style={styles.warnBanner}>
            <Text style={styles.warnText}>
              Accuracy is fair. Wait a moment for a sharper fix if you can.
            </Text>
          </View>
        ) : null}

        {accuracy !== null && accuracy > 100 ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>
              GPS is too imprecise to check in. Move outdoors and tap retry.
            </Text>
          </View>
        ) : null}

        {submitError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{submitError}</Text>
          </View>
        ) : null}

        <Pressable
          disabled={!isAccurateEnough || submitting}
          onPress={() => void submitCheckIn()}
          style={({ pressed }) => [
            styles.primaryBtn,
            (!isAccurateEnough || submitting) && styles.primaryBtnDisabled,
            pressed && { opacity: 0.92 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryBtnText}>Check in</Text>
          )}
        </Pressable>
        <Pressable onPress={() => router.back()} style={styles.cancelBtn}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: JPColors.cream,
  },
  content: {
    padding: JPSpacing.sp4,
    flex: 1,
  },
  gpsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.lg,
    padding: JPSpacing.sp4,
    borderColor: JPColors.creamDeeper,
    borderWidth: 1,
  },
  gpsLabel: {
    color: JPColors.textSub,
    fontFamily: 'Mukta_600SemiBold',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  coords: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 14,
    color: JPColors.textPrimary,
  },
  gpsHint: {
    color: JPColors.textSub,
    fontFamily: 'Mukta_400Regular',
  },
  errorText: {
    color: '#B91C1C',
    fontFamily: 'Mukta_500Medium',
    fontSize: 14,
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  accuracyLabel: {
    color: JPColors.textSub,
    fontFamily: 'Mukta_500Medium',
    fontSize: 13,
  },
  accuracyValue: {
    fontFamily: 'Mukta_700Bold',
    fontSize: 13,
  },
  warnBanner: {
    backgroundColor: '#FBEED0',
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
    marginTop: JPSpacing.sp3,
  },
  warnText: {
    color: '#B45309',
    fontFamily: 'Mukta_500Medium',
    fontSize: 13,
  },
  errorBanner: {
    backgroundColor: '#FBE5E5',
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
    marginTop: JPSpacing.sp3,
  },
  errorBannerText: {
    color: '#B91C1C',
    fontFamily: 'Mukta_500Medium',
    fontSize: 13,
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
    fontFamily: 'Mukta_700Bold',
    fontSize: 16,
  },
  secondaryBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: JPRadius.sm,
    borderColor: JPColors.creamDeeper,
    borderWidth: 1,
  },
  secondaryBtnText: {
    color: JPColors.textPrimary,
    fontFamily: 'Mukta_600SemiBold',
    fontSize: 13,
  },
  cancelBtn: {
    marginTop: JPSpacing.sp3,
    alignItems: 'center',
    paddingVertical: 12,
  },
  cancelBtnText: {
    color: JPColors.textSub,
    fontFamily: 'Mukta_500Medium',
  },
});
