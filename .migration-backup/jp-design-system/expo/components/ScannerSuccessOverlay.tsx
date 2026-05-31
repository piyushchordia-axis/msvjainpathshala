import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { tokens } from '../tokens';

export interface ScannerSuccessOverlayProps {
  open: boolean;
  /** Localized headline e.g. "Marked Present". */
  title: string;
  /** Localized subtitle e.g. "+5 Punya earned". */
  subtitle?: string;
  /** Localized dismiss CTA. Omit to hide the button. */
  dismissLabel?: string;
  onDismiss?: () => void;
  /** Custom check / glyph slot — pass any node. */
  icon?: React.ReactNode;
  /** Auto-dismiss after N ms (no-op without onDismiss). */
  autoDismissMs?: number;
  style?: StyleProp<ViewStyle>;
}

export function ScannerSuccessOverlay({
  open,
  title,
  subtitle,
  dismissLabel,
  onDismiss,
  icon,
  autoDismissMs,
  style,
}: ScannerSuccessOverlayProps) {
  const scrim = useSharedValue(0);
  const ring = useSharedValue(0);
  const lift = useSharedValue(20);

  React.useEffect(() => {
    if (open) {
      scrim.value = withTiming(1, { duration: tokens.motion.base });
      ring.value = withSequence(
        withTiming(1.08, { duration: 260 }),
        withSpring(1, { damping: 12, stiffness: 180 }),
      );
      lift.value = withSpring(0, { damping: 16, stiffness: 200 });

      if (autoDismissMs && onDismiss) {
        const t = setTimeout(onDismiss, autoDismissMs);
        return () => clearTimeout(t);
      }
    } else {
      scrim.value = withTiming(0, { duration: tokens.motion.quick });
      ring.value = 0;
      lift.value = 20;
    }
  }, [open, autoDismissMs, onDismiss, scrim, ring, lift]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ring.value }],
    opacity: ring.value > 0 ? 1 : 0,
  }));
  const bodyStyle = useAnimatedStyle(() => ({
    opacity: scrim.value,
    transform: [{ translateY: lift.value }],
  }));

  if (!open) return null;

  return (
    <Animated.View
      pointerEvents="auto"
      accessibilityViewIsModal
      accessibilityRole="alert"
      style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle, style]}
    >
      {/* Tap-out catcher */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onDismiss}
        accessibilityElementsHidden
      />

      <View pointerEvents="box-none" style={styles.center}>
        <Animated.View style={[styles.iconWrap, styles.iconWrapSuccess, ringStyle]}>
          <View style={styles.iconInner}>{icon}</View>
        </Animated.View>

        <Animated.View style={[styles.body, bodyStyle]}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </Animated.View>
      </View>

      {dismissLabel && onDismiss ? (
        <View style={styles.footer} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={dismissLabel}
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.dismiss,
              pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
            ]}
          >
            <Text style={styles.dismissLabel}>{dismissLabel}</Text>
          </Pressable>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: tokens.color.surface.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  center: {
    alignItems: 'center',
    gap: tokens.spacing[5],
    paddingHorizontal: tokens.spacing[6],
  },
  iconWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    ...tokens.shadow[3],
  },
  iconWrapSuccess: {
    backgroundColor: tokens.color.semantic.success,
  },
  iconInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    alignItems: 'center',
    gap: tokens.spacing[1] + 2,
  },
  title: {
    ...tokens.type.h2,
    fontFamily: tokens.font.display,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subtitle: {
    ...tokens.type.bodyLg,
    fontFamily: tokens.font.body,
    color: 'rgba(253,248,242,0.85)',
    textAlign: 'center',
  },
  footer: {
    position: 'absolute',
    bottom: tokens.spacing[10],
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  dismiss: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: tokens.spacing[7],
    paddingVertical: tokens.spacing[3] + 2,
    borderRadius: tokens.radius.md,
    minWidth: 200,
    alignItems: 'center',
    ...tokens.shadow[2],
  },
  dismissLabel: {
    ...tokens.type.label,
    fontFamily: tokens.font.bodySemibold,
    fontWeight: '600',
    color: tokens.color.semantic.success,
  },
});
