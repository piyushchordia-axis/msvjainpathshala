/**
 * Profile → Privacy settings.
 *
 * Hosts the blanket gallery visibility opt-in (Q6 / CLAUDE.md). Copy comes
 * verbatim from DESIGN_GUIDE.md:
 *   "When enabled, photos and videos your child submits as part of niyams
 *    may appear in our public city gallery. Personal information like full
 *    name and your contact details are never shared. You can change this
 *    anytime."
 *
 * Toggling false → true → false ALWAYS calls
 * PATCH /v1/profile/gallery-visibility — the backend backfills
 * gallery_items.removed for every existing item belonging to this parent's
 * children.
 */

import { Stack } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, unwrap } from '@/api/client';
import { niyamsApi } from '@/api/endpoints/niyams';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

interface ProfileDto {
  id: string;
  full_name: string;
  gallery_visibility_opt_in: boolean;
}

interface State {
  loading: boolean;
  optIn: boolean;
  pending: boolean;
  error: string | null;
  lastResult: { items_hidden: number; items_restored: number } | null;
}

export default function PrivacyScreen() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>({
    loading: true,
    optIn: false,
    pending: false,
    error: null,
    lastResult: null,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await unwrap<ProfileDto>(api.get('/v1/auth/me'));
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          optIn: !!me.gallery_visibility_opt_in,
        }));
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof ApiError ? err.message : 'Could not load your profile',
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onToggle(value: boolean): Promise<void> {
    setState((prev) => ({ ...prev, pending: true, error: null }));
    try {
      const result = await niyamsApi.setGalleryVisibility(value);
      setState((prev) => ({
        ...prev,
        pending: false,
        optIn: result.gallery_visibility_opt_in,
        lastResult: {
          items_hidden: result.items_hidden,
          items_restored: result.items_restored,
        },
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        pending: false,
        error: err instanceof ApiError ? err.message : 'Could not update the setting',
      }));
    }
  }

  if (state.loading) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={JPColors.saffron} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Privacy' }} />
      <ScrollView
        contentContainerStyle={{
          padding: JPSpacing.sp4,
          paddingBottom: insets.bottom + JPSpacing.sp8,
        }}
        style={{ backgroundColor: JPColors.cream, flex: 1 }}
      >
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1, marginRight: JPSpacing.sp3 }}>
              <Text style={styles.title}>Show my child's niyam photos in the city gallery</Text>
            </View>
            <Switch
              value={state.optIn}
              onValueChange={onToggle}
              disabled={state.pending}
              trackColor={{ true: JPColors.saffron, false: JPColors.border }}
              thumbColor="#FFFFFF"
            />
          </View>
          <Text style={styles.body}>
            When enabled, photos and videos your child submits as part of niyams may appear in our
            public city gallery. Personal information like full name and your contact details are
            never shared. You can change this anytime.
          </Text>
          {state.pending ? (
            <View style={styles.pendingRow}>
              <ActivityIndicator color={JPColors.saffron} size="small" />
              <Text style={styles.pendingText}>Updating…</Text>
            </View>
          ) : null}
          {state.lastResult ? (
            <View style={styles.resultBox}>
              <Text style={styles.resultText}>
                {state.lastResult.items_hidden > 0
                  ? `${state.lastResult.items_hidden} item${state.lastResult.items_hidden === 1 ? '' : 's'} hidden from the gallery.`
                  : null}
                {state.lastResult.items_restored > 0
                  ? `${state.lastResult.items_restored} item${state.lastResult.items_restored === 1 ? '' : 's'} restored to the gallery.`
                  : null}
                {state.lastResult.items_hidden === 0 && state.lastResult.items_restored === 0
                  ? 'Setting saved. No existing items needed to change.'
                  : null}
              </Text>
            </View>
          ) : null}
          {state.error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{state.error}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: JPColors.cream,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.lg,
    padding: JPSpacing.sp4,
    borderWidth: 1,
    borderColor: JPColors.border,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: JPSpacing.sp3,
  },
  title: {
    fontFamily: JPFonts.display,
    color: JPColors.maroon,
    fontSize: 16,
    lineHeight: 22,
  },
  body: {
    color: JPColors.textSub,
    fontSize: 13,
    lineHeight: 20,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: JPSpacing.sp3,
  },
  pendingText: {
    marginLeft: JPSpacing.sp2,
    color: JPColors.textSub,
    fontSize: 12,
  },
  resultBox: {
    marginTop: JPSpacing.sp3,
    backgroundColor: JPColors.successBg,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
  },
  resultText: {
    color: JPColors.success,
    fontSize: 12,
  },
  errorBox: {
    marginTop: JPSpacing.sp3,
    backgroundColor: JPColors.errorBg,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
  },
  errorText: {
    color: JPColors.error,
    fontSize: 12,
  },
});
