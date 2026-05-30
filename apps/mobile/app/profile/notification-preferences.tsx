/**
 * Notification preferences — Step 12.
 *
 * Lets a user choose which channels (push / SMS / email / in-app) they
 * receive notifications on. Current values load from `/v1/auth/me`; each
 * change persists immediately via PATCH /v1/users/me/notification-preferences.
 * SMS/email to opted-out users is suppressed server-side (see CLAUDE.md
 * notification rules), so this screen is the single source of consent.
 */

import { Stack } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, unwrap } from '@/api/client';
import { notificationsApi, type NotificationPreferences } from '@/api/endpoints/notifications';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

const DEFAULTS: NotificationPreferences = { push: true, sms: true, email: true, in_app: true };

interface Row {
  key: keyof NotificationPreferences;
  title: string;
  subtitle: string;
}

const ROWS: Row[] = [
  { key: 'push', title: 'Push notifications', subtitle: 'Alerts on this device' },
  { key: 'sms', title: 'SMS', subtitle: 'Text messages for important updates' },
  { key: 'email', title: 'Email', subtitle: 'Summaries and monthly reports' },
  { key: 'in_app', title: 'In-app', subtitle: 'Messages inside the app' },
];

export default function NotificationPreferencesScreen() {
  const insets = useSafeAreaInsets();
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<keyof NotificationPreferences | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await unwrap<{ notification_preferences?: Partial<NotificationPreferences> }>(
        api.get('/v1/auth/me'),
      );
      setPrefs({ ...DEFAULTS, ...(me.notification_preferences ?? {}) });
    } catch (err) {
      // Fall back to sensible defaults so the screen stays usable.
      setPrefs(DEFAULTS);
      if (err instanceof ApiError && err.code !== 'ERR_RESOURCE_NOT_FOUND') {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (key: keyof NotificationPreferences, value: boolean) => {
      const previous = prefs;
      setPrefs({ ...prefs, [key]: value });
      setSavingKey(key);
      setError(null);
      setSaved(false);
      try {
        const patch = { [key]: value } as Partial<NotificationPreferences>;
        const updated = await notificationsApi.updatePreferences(patch);
        setPrefs({ ...DEFAULTS, ...updated });
        setSaved(true);
      } catch (err) {
        setPrefs(previous); // revert on failure
        setError(err instanceof ApiError ? err.message : 'Could not save — please try again');
      } finally {
        setSavingKey(null);
      }
    },
    [prefs],
  );

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ title: 'Notifications' }} />
        <ActivityIndicator color={JPColors.saffron} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { paddingTop: insets.top }]}
      contentContainerStyle={styles.scroll}
    >
      <Stack.Screen options={{ title: 'Notifications' }} />
      <Text style={styles.title}>Notifications</Text>
      <Text style={styles.subtle}>
        Choose how you'd like to hear from us. You can change these anytime.
      </Text>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {saved && !error ? <Text style={styles.savedText}>Saved</Text> : null}

      <View style={styles.card}>
        {ROWS.map((row, idx) => (
          <View key={row.key} style={[styles.row, idx < ROWS.length - 1 && styles.rowDivider]}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{row.title}</Text>
              <Text style={styles.rowSubtitle}>{row.subtitle}</Text>
            </View>
            <Switch
              value={prefs[row.key]}
              disabled={savingKey === row.key}
              onValueChange={(v) => void toggle(row.key, v)}
              trackColor={{ true: JPColors.saffron, false: JPColors.creamDeeper }}
            />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: JPColors.cream },
  scroll: { padding: JPSpacing.sp4, gap: JPSpacing.sp3 },
  centered: {
    flex: 1,
    backgroundColor: JPColors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: JPColors.textPrimary, fontFamily: JPFonts.display, fontSize: 22 },
  subtle: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 13, lineHeight: 22 },
  errorText: { color: JPColors.error, fontFamily: JPFonts.body, fontSize: 13 },
  savedText: { color: JPColors.success, fontFamily: JPFonts.body, fontSize: 13, fontWeight: '700' },
  card: {
    backgroundColor: JPColors.creamDark,
    borderRadius: JPRadius.lg,
    paddingHorizontal: JPSpacing.sp4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: JPSpacing.sp3,
    gap: JPSpacing.sp3,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: JPColors.border },
  rowText: { flex: 1, gap: 2 },
  rowTitle: {
    color: JPColors.textPrimary,
    fontFamily: JPFonts.body,
    fontSize: 15,
    fontWeight: '600',
  },
  rowSubtitle: { color: JPColors.textSub, fontFamily: JPFonts.body, fontSize: 12, lineHeight: 18 },
});
