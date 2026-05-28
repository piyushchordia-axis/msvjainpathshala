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

export interface ScannerErrorOverlayProps {
  open: boolean;
  /** Localized headline e.g. "Scan failed". */
  title: string;
  /** Localized subtitle e.g. "QR code expired. Ask Sanchalak to refresh." */
  subtitle?: string;
  /** Localized retry CTA. */
  retryLabel?: string;
  onRetry?: () => void;
  /** Localized cancel / close CTA. */
  cancelLabel?: string;
  onCancel?: () => void;
  /** Custom error glyph slot. */
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function ScannerErrorOverlay({
  open,
  title,
  subtitle,
  retryLabel,
  cancelLabel,
  onRetry,
  onCancel,
  icon,
  style,
}: ScannerErrorOverlayProps) {
  const scrim = useSharedValue(0);
  const shake = useSharedValue(0);
  const scale = useSharedValue(0.92);

  React.useEffect(() => {
    if (open) {
      scrim.value = withTiming(1, { duration: tokens.motion.base });
      scale.value = withSpring(1, { damping: 16, stiffness: 200 });
      shake.value = withSequence(
        withTiming(-8, { duration: 60 }),
        withTiming(8,  { duration: 60 }),
        withTiming(-6, { duration: 60 }),
        withTiming(6,  { duration: 60 }),
        withTiming(0,  { duration: 60 }),
      );
    } else {
      scrim.value = withTiming(0, { duration: tokens.motion.quick });
      scale.value = 0.92;
      shake.value = 0;
    }
  }, [open, scrim, scale, shake]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateX: shake.value }],
  }));

  if (!open) return null;

  return (
    <Animated.View
      pointerEvents="auto"
      accessibilityViewIsModal
      accessibilityRole="alert"
      style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle, style]}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onCancel}
        accessibilityElementsHidden
      />

      <View pointerEvents="box-none" style={styles.center}>
        <Animated.View style={[styles.iconWrap, iconStyle]}>
          <View style={styles.iconInner}>{icon}</View>
        </Animated.View>

        <View style={styles.body}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>

        {(retryLabel || cancelLabel) ? (
          <View style={styles.actions}>
            {cancelLabel && onCancel ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={cancelLabel}
                onPress={onCancel}
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnGhost,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.btnGhostLabel}>{cancelLabel}</Text>
              </Pressable>
            ) : null}

            {retryLabel && onRetry ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={retryLabel}
                onPress={onRetry}
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnPrimary,
                  pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
                ]}
              >
                <Text style={styles.btnPrimaryLabel}>{retryLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: tokens.color.surface.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: tokens.spacing[5],
  },
  center: {
    alignItems: 'center',
    gap: tokens.spacing[5],
  },
  iconWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: tokens.color.semantic.error,
    alignItems: 'center',
    justifyContent: 'center',
    ...tokens.shadow[3],
  },
  iconInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    alignItems: 'center',
    gap: tokens.spacing[1] + 2,
    paddingHorizontal: tokens.spacing[6],
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
  actions: {
    flexDirection: 'row',
    gap: tokens.spacing[3],
    marginTop: tokens.spacing[2],
  },
  btn: {
    paddingHorizontal: tokens.spacing[5],
    paddingVertical: tokens.spacing[3] + 2,
    borderRadius: tokens.radius.md,
    minWidth: 130,
    alignItems: 'center',
  },
  btnPrimary: {
    backgroundColor: '#FFFFFF',
    ...tokens.shadow[2],
  },
  btnPrimaryLabel: {
    ...tokens.type.label,
    fontFamily: tokens.font.bodySemibold,
    fontWeight: '600',
    color: tokens.color.semantic.error,
  },
  btnGhost: {
    borderWidth: 1.5,
    borderColor: 'rgba(253,248,242,0.7)',
    backgroundColor: 'transparent',
  },
  btnGhostLabel: {
    ...tokens.type.label,
    fontFamily: tokens.font.bodySemibold,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
