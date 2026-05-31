/**
 * AppToast — global imperative toaster for the mobile app.
 *
 * A module-scope emitter lets any screen fire feedback without prop-drilling:
 *
 *   import { appToast } from '@/components/ui/feedback/AppToast';
 *   appToast.success('Saved', 'Your changes are saved.');
 *   appToast.error('Could not save', err.message);
 *   appToast.warning('Heads up', '…');
 *   appToast.info('FYI', '…');
 *
 * A single <AppToastHost /> (mounted once in app/_layout.tsx) renders the
 * stack at the top of the screen. Visual language mirrors SyncToast /
 * InAppToast — white card, 12-px radius, maroon-tinted shadow, a coloured
 * left accent strip per intent. Each toast auto-dismisses after 4s.
 *
 * This is distinct from InAppToast (foreground *push notifications*) and
 * SyncToast (offline drain confirmations) — those stay as-is; this is the
 * generic success/error/warning channel for in-app actions.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

export type AppToastTone = 'success' | 'error' | 'warning' | 'info';

export interface AppToastItem {
  id: string;
  tone: AppToastTone;
  title: string;
  description?: string;
}

type Listener = (items: AppToastItem[]) => void;

const AUTO_DISMISS_MS = 4_000;

let items: AppToastItem[] = [];
const listeners = new Set<Listener>();
let seq = 0;

function emit(): void {
  for (const l of listeners) l([...items]);
}

function remove(id: string): void {
  items = items.filter((i) => i.id !== id);
  emit();
}

function push(tone: AppToastTone, title: string, description?: string): void {
  seq += 1;
  const id = `t${seq}`;
  items = [...items, { id, tone, title, ...(description ? { description } : {}) }];
  emit();
  setTimeout(() => remove(id), AUTO_DISMISS_MS);
}

export const appToast = {
  success: (title: string, description?: string) => push('success', title, description),
  error: (title: string, description?: string) => push('error', title, description),
  warning: (title: string, description?: string) => push('warning', title, description),
  info: (title: string, description?: string) => push('info', title, description),
};

function accentFor(tone: AppToastTone): { bar: string; bubble: string; glyph: string } {
  switch (tone) {
    case 'success':
      return { bar: JPColors.success, bubble: JPColors.successBg, glyph: '✓' };
    case 'error':
      return { bar: JPColors.error, bubble: JPColors.errorBg, glyph: '!' };
    case 'warning':
      return { bar: JPColors.warning, bubble: JPColors.warningBg, glyph: '!' };
    default:
      return { bar: JPColors.saffron, bubble: JPColors.saffron50, glyph: 'i' };
  }
}

function ToastCard({ item }: { item: AppToastItem }): React.JSX.Element {
  const accent = accentFor(item.tone);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <Animated.View style={[styles.cardWrap, { opacity, transform: [{ translateY }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.tone}: ${item.title}`}
        onPress={() => remove(item.id)}
        style={[styles.card, { borderLeftColor: accent.bar }]}
      >
        <View style={[styles.iconBubble, { backgroundColor: accent.bubble }]}>
          <Text style={[styles.iconGlyph, { color: accent.bar }]}>{accent.glyph}</Text>
        </View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          {item.description ? (
            <Text style={styles.description} numberOfLines={3}>
              {item.description}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function AppToastHost(): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const [stack, setStack] = useState<AppToastItem[]>([]);

  useEffect(() => {
    const listener: Listener = (next) => setStack(next);
    listeners.add(listener);
    setStack([...items]);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (stack.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 8 }]}>
      {stack.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 1001,
    elevation: 9,
    gap: JPSpacing.sp2,
  },
  cardWrap: {},
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.lg ?? 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderLeftWidth: 3,
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
  iconGlyph: { fontSize: 18, fontWeight: '700' },
  body: { flex: 1 },
  title: {
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 14,
    color: JPColors.textPrimary,
  },
  description: {
    fontFamily: JPFonts.body,
    fontSize: 12,
    color: JPColors.textSub,
    marginTop: 2,
    lineHeight: 18,
  },
});
