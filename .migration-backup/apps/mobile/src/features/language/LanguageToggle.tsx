/**
 * LanguageToggle — segmented EN/HI control wired to:
 *   1. i18next.changeLanguage() — re-renders every `useTranslation()` consumer
 *   2. profileStore — persists per-device so the next cold start uses the
 *      same language without waiting on a /me round trip
 *   3. PATCH /v1/auth/me { preferred_language } — server-side sync so the
 *      user's language follows them to web / other devices
 *
 * Errors on the server-side PATCH are surfaced as a small inline message
 * but don't roll back the local change — the local override stays in
 * effect and the next successful PATCH (sync engine retry, or a manual
 * re-tap) reconciles.
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { authApi } from '@/api/endpoints/auth';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';
import { profileStore } from '@/storage/stores/profile.store';

const LANGUAGES: Array<{ code: 'en' | 'hi'; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
];

interface Props {
  /** When false, only updates local state — useful pre-login on the (auth) group. */
  syncToServer?: boolean;
}

export function LanguageToggle({ syncToServer = true }: Props) {
  const { i18n, t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [pendingLang, setPendingLang] = useState<'en' | 'hi' | null>(null);

  const current = (i18n.resolvedLanguage as 'en' | 'hi') ?? 'en';

  const select = useCallback(
    async (lang: 'en' | 'hi') => {
      if (lang === current) return;
      setError(null);
      setPendingLang(lang);
      // Apply locally first (optimistic) so the UI re-renders immediately.
      await i18n.changeLanguage(lang);
      profileStore.set({ preferred_language: lang });
      if (!syncToServer) {
        setPendingLang(null);
        return;
      }
      try {
        await authApi.updateMe({ preferred_language: lang });
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : t('language.sync_failed', {
                defaultValue: "Saved locally. We'll sync to your account when you're back online.",
              }),
        );
      } finally {
        setPendingLang(null);
      }
    },
    [current, i18n, syncToServer, t],
  );

  return (
    <View>
      <Text style={styles.label}>{t('language.heading', { defaultValue: 'Language' })}</Text>
      <View style={styles.row}>
        {LANGUAGES.map((opt) => {
          const isActive = current === opt.code;
          const isPending = pendingLang === opt.code;
          return (
            <Pressable
              key={opt.code}
              onPress={() => void select(opt.code)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              style={[styles.option, isActive && styles.optionActive]}
            >
              <Text style={[styles.optionText, isActive && styles.optionTextActive]}>
                {opt.label}
                {isPending ? ' …' : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    color: JPColors.textSub,
    marginBottom: JPSpacing.sp2,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  row: {
    flexDirection: 'row',
    backgroundColor: JPColors.creamDark,
    borderRadius: JPRadius.md,
    padding: 4,
  },
  option: {
    flex: 1,
    paddingVertical: JPSpacing.sp3,
    borderRadius: JPRadius.sm,
    alignItems: 'center',
  },
  optionActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: JPColors.saffron,
  },
  optionText: {
    fontFamily: JPFonts.body,
    fontSize: 15,
    color: JPColors.textSub,
  },
  optionTextActive: {
    color: JPColors.saffron,
    fontWeight: '600',
  },
  error: {
    marginTop: JPSpacing.sp2,
    fontFamily: JPFonts.body,
    fontSize: 13,
    color: JPColors.warning,
  },
});
