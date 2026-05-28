import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { tokens } from '../tokens';

export type OfflineBannerSeverity = 'soft' | 'hard';

export interface OfflineBannerProps {
  /** Drive from a `useNetInfo()` hook. */
  open: boolean;
  /** Localized message. */
  label: string;
  /** Localized retry CTA copy. Omit to hide the button. */
  retryLabel?: string;
  onRetry?: () => void;
  /** soft = amber inline band; hard = red top-of-screen band. */
  severity?: OfflineBannerSeverity;
  /** Custom leading icon slot. */
  leadingIcon?: React.ReactNode;
  /** Custom retry icon slot. */
  retryIcon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const palettes: Record<OfflineBannerSeverity, { bg: string; fg: string; border: string }> = {
  soft: {
    bg:     tokens.color.semantic.warningBg,
    fg:     tokens.color.semantic.warning,
    border: tokens.color.semantic.warning,
  },
  hard: {
    bg:     tokens.color.semantic.error,
    fg:     '#FFFFFF',
    border: tokens.color.semantic.error,
  },
};

export function OfflineBanner({
  open,
  label,
  retryLabel,
  onRetry,
  severity = 'soft',
  leadingIcon,
  retryIcon,
  style,
}: OfflineBannerProps) {
  const progress = useSharedValue(open ? 1 : 0);

  React.useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: tokens.motion.base });
  }, [open, progress]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -8 }],
  }));

  if (!open) return null;

  const p = palettes[severity];

  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        { backgroundColor: p.bg, borderBottomColor: p.border },
        animated,
        style,
      ]}
    >
      {leadingIcon ? <View style={styles.icon}>{leadingIcon}</View> : null}

      <Text
        style={[styles.label, { color: p.fg }]}
        numberOfLines={2}
      >
        {label}
      </Text>

      {onRetry && retryLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          onPress={onRetry}
          hitSlop={8}
          style={({ pressed }) => [
            styles.retry,
            pressed && { opacity: 0.6 },
          ]}
        >
          {retryIcon}
          <Text style={[styles.retryLabel, { color: p.fg }]}>{retryLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing[2],
    paddingHorizontal: tokens.spacing[4],
    paddingVertical: tokens.spacing[2],
    borderBottomWidth: 1,
  },
  icon: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    ...tokens.type.label,
    fontFamily: tokens.font.bodySemibold,
    fontWeight: '600',
  },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing[1],
    paddingHorizontal: tokens.spacing[2],
    paddingVertical: tokens.spacing[1],
    borderRadius: tokens.radius.sm,
  },
  retryLabel: {
    ...tokens.type.caption,
    fontFamily: tokens.font.bodyBold,
    fontWeight: '700',
  },
});
