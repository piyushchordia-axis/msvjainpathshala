/**
 * OTP-entry screen. Six monospace cells, auto-advance on key, paste
 * supported, 60s resend countdown.
 *
 * Cell design follows `jp-design-system/preview/otp-input.html`:
 *   - 56×64 cell, 1.5px border (2px on focus), 14px radius
 *   - JetBrainsMono 28
 *   - focus ring: 3px saffron-tinted (CSS box-shadow; on RN we approximate
 *     with a wrapping View that gets a 3px saffron border on the active
 *     cell)
 *   - error state: maroon border + maroon-50 background fill
 *
 * On successful verify we hand off to AuthProvider.signIn(), which writes
 * tokens, persists snapshot, persists language, and flips status →
 * `authenticated`. The Index splash router then redirects to the role's
 * tab group.
 */

import * as Application from 'expo-application';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { authApi } from '@/api/endpoints/auth';
import { GhostButton, PrimaryButton } from '@/components/ui';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';
import { useAuth } from '@/features/auth/auth-context';

const CELL_COUNT = 6;
const RESEND_SECONDS = 60;

function devicePlatform(): 'ios' | 'android' | 'web' {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

function deviceId(): string {
  // Stable per-install id where available, opaque random fallback. Every
  // accessor is wrapped because expo-application's web shim has historically
  // thrown / returned non-functions on platforms it doesn't implement (and
  // we never want this to bring down the OTP flow with a sync exception
  // *before* the API call leaves the device).
  try {
    if (Platform.OS === 'android' && typeof Application.getAndroidId === 'function') {
      const aid = Application.getAndroidId();
      if (aid) return aid;
    }
  } catch {
    // fall through
  }
  try {
    const appId = (Application as { applicationId?: string | null }).applicationId;
    if (appId) return appId;
  } catch {
    // fall through
  }
  return `${Platform.OS}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function OtpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const params = useLocalSearchParams<{ phone?: string; otp_token?: string }>();
  const phone = params.phone ?? '';
  const otpToken = params.otp_token ?? '';

  const [cells, setCells] = useState<string[]>(() => Array(CELL_COUNT).fill(''));
  const [focused, setFocused] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);
  const inputs = useRef<Array<TextInput | null>>([]);

  const code = useMemo(() => cells.join(''), [cells]);
  const canSubmit = code.length === CELL_COUNT && !busy;

  // 60s resend countdown
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const id = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  const focusCell = useCallback((index: number) => {
    const i = Math.max(0, Math.min(index, CELL_COUNT - 1));
    inputs.current[i]?.focus();
    setFocused(i);
  }, []);

  const handleChange = useCallback(
    (idx: number, raw: string) => {
      const digits = raw.replace(/\D+/g, '');
      // Paste path: spread across cells from current index.
      if (digits.length > 1) {
        const next = [...cells];
        for (let i = 0; i < digits.length && idx + i < CELL_COUNT; i++) {
          next[idx + i] = digits[i] ?? '';
        }
        setCells(next);
        const lastFilled = Math.min(idx + digits.length, CELL_COUNT) - 1;
        focusCell(lastFilled + 1);
        return;
      }
      const next = [...cells];
      next[idx] = digits.slice(-1) ?? '';
      setCells(next);
      if (digits) focusCell(idx + 1);
    },
    [cells, focusCell],
  );

  const handleKeyPress = useCallback(
    (idx: number, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (e.nativeEvent.key === 'Backspace' && !cells[idx] && idx > 0) {
        focusCell(idx - 1);
      }
    },
    [cells, focusCell],
  );

  const verify = useCallback(async () => {
    if (!canSubmit) return;
    if (!otpToken) {
      // Defensive: should never happen because phone.tsx always forwards it,
      // but if the user deep-links straight to /otp we surface the missing
      // token instead of failing silently.
      setError(
        t('auth.otp.errors.missing_token', {
          defaultValue: 'Session expired. Please go back and request a new OTP.',
        }),
      );
      return;
    }
    setError(null);
    setBusy(true);
    try {
      // eslint-disable-next-line no-console
      console.log('[auth] verifying OTP', { phone, otpToken: `${otpToken.slice(0, 6)}…` });
      const resp = await authApi.otpVerify({
        otp_token: otpToken,
        code,
        device_id: deviceId(),
        platform: devicePlatform(),
      });
      await signIn(resp);
      router.replace('/');
    } catch (err) {
      console.warn('[auth] verify failed', err);
      setError(
        err instanceof ApiError
          ? err.message
          : t('auth.otp.errors.generic', {
              defaultValue: 'That OTP is incorrect — check your SMS and try again.',
            }),
      );
      setBusy(false);
    }
  }, [canSubmit, code, otpToken, phone, router, signIn, t]);

  const resend = useCallback(async () => {
    if (resendIn > 0 || !phone) return;
    setError(null);
    try {
      const { otp_token: newToken } = await authApi.otpSend(phone);
      // Update the route param so the next verify uses the fresh token.
      router.setParams({ otp_token: newToken });
      setResendIn(RESEND_SECONDS);
      setCells(Array(CELL_COUNT).fill(''));
      focusCell(0);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : t('auth.otp.errors.resend', {
              defaultValue: 'Could not resend the OTP. Try again in a moment.',
            }),
      );
    }
  }, [resendIn, phone, focusCell, router, t]);

  useEffect(() => {
    if (code.length === CELL_COUNT) {
      void verify();
    }
  }, [code, verify]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + JPSpacing.sp7 }]}>
      <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={20}>
        <Text style={styles.back}>{t('common.back', { defaultValue: 'Back' })}</Text>
      </Pressable>

      <View style={styles.brand}>
        <Text style={styles.title}>{t('auth.otp.title', { defaultValue: 'Enter the OTP' })}</Text>
        <Text style={styles.body}>
          {t('auth.otp.body', {
            defaultValue: 'We sent a 6-digit code to {{phone}}.',
            phone,
          })}
        </Text>
      </View>

      <View style={styles.cellsRow}>
        {cells.map((value, i) => {
          const isFocused = focused === i;
          const hasError = error !== null;
          return (
            <View
              key={i}
              style={[
                styles.cellWrap,
                isFocused && !hasError && styles.cellWrapFocus,
                hasError && styles.cellWrapError,
              ]}
            >
              <TextInput
                ref={(ref) => {
                  inputs.current[i] = ref;
                }}
                value={value}
                onChangeText={(raw) => handleChange(i, raw)}
                onKeyPress={(e) => handleKeyPress(i, e)}
                onFocus={() => setFocused(i)}
                keyboardType="number-pad"
                maxLength={CELL_COUNT}
                style={[styles.cell, hasError && styles.cellError]}
                autoFocus={i === 0}
                selectionColor={JPColors.saffron}
                accessibilityLabel={`OTP digit ${i + 1}`}
              />
            </View>
          );
        })}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.cta}>
        <PrimaryButton onPress={verify} disabled={!canSubmit} loading={busy}>
          {busy
            ? t('auth.otp.verifying', { defaultValue: 'Verifying…' })
            : t('auth.otp.cta', { defaultValue: 'Verify' })}
        </PrimaryButton>
      </View>

      <View style={styles.resendRow}>
        {resendIn > 0 ? (
          <Text style={styles.resendCountdown}>
            {t('auth.otp.resend_in', {
              defaultValue: 'Resend in {{seconds}}s',
              seconds: resendIn,
            })}
          </Text>
        ) : (
          <GhostButton onPress={resend}>
            {t('auth.otp.resend', { defaultValue: 'Resend OTP' })}
          </GhostButton>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: JPColors.cream,
    paddingHorizontal: JPSpacing.sp4,
  },
  back: {
    fontFamily: JPFonts.body,
    color: JPColors.maroon,
    fontSize: 15,
  },
  brand: {
    marginTop: JPSpacing.sp6,
    marginBottom: JPSpacing.sp7,
  },
  title: {
    fontFamily: JPFonts.display,
    fontSize: 26,
    lineHeight: 34,
    color: JPColors.maroon,
    marginBottom: JPSpacing.sp2,
  },
  body: {
    fontFamily: JPFonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: JPColors.textSub,
  },
  cellsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: JPSpacing.sp5,
  },
  cellWrap: {
    width: 48,
    height: 64,
    borderRadius: JPRadius.md,
    borderWidth: 1.5,
    borderColor: JPColors.border,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  cellWrapFocus: {
    borderColor: JPColors.saffron,
    borderWidth: 2,
  },
  cellWrapError: {
    borderColor: JPColors.maroon,
    backgroundColor: JPColors.maroon50,
  },
  cell: {
    flex: 1,
    textAlign: 'center',
    fontFamily: JPFonts.mono,
    fontSize: 26,
    color: JPColors.textPrimary,
  },
  cellError: {
    color: JPColors.maroon,
  },
  errorText: {
    fontFamily: JPFonts.body,
    color: JPColors.error,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: JPSpacing.sp3,
  },
  cta: {
    marginTop: JPSpacing.sp3,
  },
  resendRow: {
    marginTop: JPSpacing.sp5,
    alignItems: 'center',
  },
  resendCountdown: {
    fontFamily: JPFonts.body,
    color: JPColors.textSub,
    fontSize: 14,
  },
});
