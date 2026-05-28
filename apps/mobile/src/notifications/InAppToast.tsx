/**
 * InAppToast — foreground notification banner.
 *
 * Visual reference: `jp-design-system/preview/toast.html` — white card,
 * 12-px radius, soft maroon-tinted shadow, 3-px coloured accent strip on
 * the left. Three intents: success (green), error (red), info (saffron
 * for ordinary notifications). All copy is bilingual; the banner picks
 * the language from the active i18n preference.
 *
 * Lifecycle:
 *   - mount: registers as a foreground-push listener
 *   - on push: enqueues for display, auto-dismisses after 4.5 s
 *   - tap: invokes the supplied router so the host app can deep-link
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { JPColors, JPRadius } from '@/constants/colors';
import { useLanguage } from '@/features/language/use-language';

import { onForegroundNotification } from './device-token';

import type { NotificationFeedItem } from '@/api/endpoints/notifications';

const AUTO_DISMISS_MS = 4_500;

export interface InAppToastProps {
  onTap?: (notification: NotificationFeedItem) => void;
}

function pickStrings(notif: NotificationFeedItem, language: 'en' | 'hi') {
  return language === 'hi'
    ? { title: notif.title_hi, body: notif.body_hi }
    : { title: notif.title_en, body: notif.body_en };
}

export function InAppToast({ onTap }: InAppToastProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const language = useLanguage();
  const [current, setCurrent] = useState<NotificationFeedItem | null>(null);
  const translateY = useRef(new Animated.Value(-120)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback((): void => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    Animated.timing(translateY, {
      toValue: -120,
      duration: 220,
      useNativeDriver: true,
    }).start(() => setCurrent(null));
  }, [translateY]);

  const show = useCallback(
    (notif: NotificationFeedItem) => {
      setCurrent(notif);
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(dismiss, AUTO_DISMISS_MS);
    },
    [dismiss, translateY],
  );

  useEffect(() => {
    const unsub = onForegroundNotification((n) => show(n));
    return () => {
      unsub();
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [show]);

  if (!current) return null;
  const { title, body } = pickStrings(current, language);
  const accent = pickAccent(current.kind);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.container, { top: insets.top + 8, transform: [{ translateY }] }]}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          onTap?.(current);
          dismiss();
        }}
        style={[styles.card, { borderLeftColor: accent.barColor }]}
      >
        <View style={[styles.iconBubble, { backgroundColor: accent.bubble }]}>
          <Text style={[styles.iconGlyph, { color: accent.barColor }]}>•</Text>
        </View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {body ? (
            <Text style={styles.bodyText} numberOfLines={2}>
              {body}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel="Dismiss"
          onPress={dismiss}
          hitSlop={8}
          style={styles.closeBtn}
        >
          <Text style={styles.closeGlyph}>×</Text>
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

function pickAccent(kind: string): { barColor: string; bubble: string } {
  if (kind.includes('rejected') || kind.includes('failed') || kind === 'session.cancelled') {
    return { barColor: JPColors.error, bubble: JPColors.errorBg };
  }
  if (
    kind.includes('approved') ||
    kind === 'idcard.ready' ||
    kind === 'punya.tier_upgrade' ||
    kind === 'streak.badge_earned'
  ) {
    return { barColor: JPColors.success, bubble: JPColors.successBg };
  }
  return { barColor: JPColors.saffron, bubble: JPColors.saffron50 };
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 1000,
    elevation: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.lg ?? 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderLeftWidth: 3,
    // RN shadow — mirror the maroon-tinted card shadow from toast.html.
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
  },
  iconGlyph: {
    fontSize: 22,
    lineHeight: 24,
    marginTop: -2,
  },
  body: { flex: 1 },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: JPColors.textPrimary,
  },
  bodyText: {
    fontSize: 12,
    color: JPColors.textSub,
    marginTop: 2,
    lineHeight: 18,
  },
  closeBtn: { padding: 4 },
  closeGlyph: {
    fontSize: 16,
    color: '#C4A882',
    lineHeight: 18,
  },
});
