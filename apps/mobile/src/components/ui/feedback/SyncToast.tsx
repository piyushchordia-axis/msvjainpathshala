/**
 * SyncToast — saffron success toast that fires after a drain cycle commits
 * one or more ops to the server. Visual: maroon-tinted card shadow (mirrors
 * `preview/toast.html`) + saffron accent strip.
 *
 * State source: `useSyncIssuesStore.pending_drained_count`. The component
 * subscribes; when the counter increments, it shows for ~3.5s and consumes
 * the counter (resets to 0) on dismiss so the next drain triggers a fresh
 * toast.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { JPColors, JPFonts, JPRadius } from '@/constants/colors';
import { useSyncIssuesStore } from '@/stores/sync-issues.store';

const AUTO_DISMISS_MS = 3_500;

export function SyncToast(): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const drained = useSyncIssuesStore((s) => s.pending_drained_count);
  const consume = useSyncIssuesStore((s) => s.consumeDrainedToast);
  const translateY = useRef(new Animated.Value(-100)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (drained <= 0) return;
    Animated.timing(translateY, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => {
      Animated.timing(translateY, {
        toValue: -100,
        duration: 220,
        useNativeDriver: true,
      }).start(() => consume());
    }, AUTO_DISMISS_MS);
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [drained, translateY, consume]);

  if (drained <= 0) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.container, { top: insets.top + 8, transform: [{ translateY }] }]}
    >
      <View style={styles.card}>
        <View style={styles.iconBubble}>
          <Text style={styles.iconGlyph}>✓</Text>
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>
            {drained === 1 ? '1 action synced' : `${drained} actions synced`}
          </Text>
          <Text style={styles.subtitle}>Your offline changes are saved.</Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 999,
    elevation: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderLeftWidth: 3,
    borderLeftColor: JPColors.saffron,
    shadowColor: JPColors.maroon,
    shadowOpacity: 0.1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: JPColors.saffron50,
  },
  iconGlyph: {
    fontSize: 18,
    color: JPColors.saffron,
    fontWeight: '700',
  },
  body: { flex: 1 },
  title: {
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 14,
    color: JPColors.textPrimary,
  },
  subtitle: {
    fontFamily: JPFonts.body,
    fontSize: 12,
    color: JPColors.textSub,
    marginTop: 2,
  },
});
