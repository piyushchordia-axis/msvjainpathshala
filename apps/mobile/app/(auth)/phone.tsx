/**
 * Phone-entry screen. Layout mirrors `jp-design-system/ui_kits/mobile/screens.jsx`
 * (LoginScreen): cream bg, "Welcome" header in Tiro Devanagari Sanskrit,
 * sub-copy in Mukta, fixed `+91` prefix + 10-digit input, primary CTA
 * "Send OTP".
 *
 * On submit → POST /v1/auth/otp/send → navigate to /otp?phone=…&otp_token=…
 *
 * Phone format: we accept 10 digits and prepend `+91`. India-only for the
 * v1 launch (Section 3.1: SMS via MSG91, India numbers only). When we
 * expand internationally the schema in `@jp/shared` already accepts E.164.
 */

import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { authApi } from '@/api/endpoints/auth';
import { PrimaryButton } from '@/components/ui';
import { JPColors, JPFonts, JPSpacing } from '@/constants/colors';

export default function PhoneScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = digits.length === 10 && !busy;
  const e164 = `+91${digits}`;

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      const { otp_token } = await authApi.otpSend(e164);
      router.push({ pathname: '/(auth)/otp', params: { phone: e164, otp_token } });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : t('auth.errors.generic', { defaultValue: 'Something went wrong. Try again.' }),
      );
    } finally {
      setBusy(false);
    }
  }, [canSubmit, e164, router, t]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + JPSpacing.sp7 }]}>
      <View style={styles.brand}>
        <Text style={styles.display}>
          {t('common.app_name', { defaultValue: 'Jain Pathshala' })}
        </Text>
        <Text style={styles.subDisplay}>श्री महावीराय नमः</Text>
      </View>

      <View style={styles.formCard}>
        <Text style={styles.title}>{t('auth.phone.title', { defaultValue: 'Sign in' })}</Text>
        <Text style={styles.body}>
          {t('auth.phone.body', {
            defaultValue: "Enter your mobile number. We'll send you a one-time code by SMS.",
          })}
        </Text>

        <View style={styles.inputRow}>
          <View style={styles.prefixBox}>
            <Text style={styles.prefixText}>+91</Text>
          </View>
          <TextInput
            style={styles.input}
            value={digits}
            onChangeText={(v) => setDigits(v.replace(/\D+/g, '').slice(0, 10))}
            keyboardType="number-pad"
            placeholder="98765 43210"
            placeholderTextColor={JPColors.textDim}
            maxLength={10}
            autoFocus
            accessibilityLabel="Mobile number"
            returnKeyType="done"
            onSubmitEditing={onSubmit}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.cta}>
          <PrimaryButton onPress={onSubmit} disabled={!canSubmit} loading={busy}>
            {busy
              ? t('common.loading', { defaultValue: 'Sending…' })
              : t('auth.phone.cta', { defaultValue: 'Send OTP' })}
          </PrimaryButton>
        </View>

        <Text style={styles.helper}>
          {t('auth.phone.helper', {
            defaultValue:
              'Trouble logging in? Ask your Sanchalak or Guruji to verify your phone is registered.',
          })}
        </Text>
      </View>

      {busy ? (
        <View style={styles.busyOverlay}>
          <ActivityIndicator color={JPColors.saffron} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: JPColors.cream,
    paddingHorizontal: JPSpacing.sp4,
  },
  brand: {
    alignItems: 'center',
    marginTop: JPSpacing.sp6,
    marginBottom: JPSpacing.sp9,
  },
  display: {
    fontFamily: JPFonts.display,
    fontSize: 32,
    lineHeight: 40,
    color: JPColors.maroon,
  },
  subDisplay: {
    fontFamily: JPFonts.display,
    fontSize: 17,
    lineHeight: 24,
    color: JPColors.textSub,
    marginTop: JPSpacing.sp2,
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: JPSpacing.sp6,
    borderWidth: 1,
    borderColor: JPColors.border,
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
    marginBottom: JPSpacing.sp6,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: JPColors.border,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: JPColors.creamDark,
  },
  prefixBox: {
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: JPSpacing.sp4,
    borderRightWidth: 1,
    borderRightColor: JPColors.border,
    backgroundColor: '#FFFFFF',
  },
  prefixText: {
    fontFamily: JPFonts.body,
    fontSize: 17,
    color: JPColors.textPrimary,
  },
  input: {
    flex: 1,
    fontFamily: JPFonts.body,
    fontSize: 18,
    color: JPColors.textPrimary,
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: JPSpacing.sp4,
    letterSpacing: 1.2,
  },
  cta: {
    marginTop: JPSpacing.sp6,
  },
  helper: {
    marginTop: JPSpacing.sp5,
    fontFamily: JPFonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: JPColors.textSub,
    textAlign: 'center',
  },
  error: {
    marginTop: JPSpacing.sp3,
    fontFamily: JPFonts.body,
    color: JPColors.error,
    fontSize: 14,
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(253, 248, 242, 0.4)',
  },
});
