import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { bodyFamily, displayFamily, fonts } from "@/constants/typography";
import { useActivityPageBg, useActivityTheme } from "@/contexts/ActivityThemeContext";
import { useLocale } from "@/contexts/LocaleContext";
import { useColors } from "@/hooks/useColors";

/** Web-only top inset for the status bar (see expo skill "Insets"). */
export function useWebTopInset() {
  const insets = useSafeAreaInsets();
  return Platform.OS === "web" ? Math.max(insets.top, 12) : insets.top;
}

/** A scrollable screen body with brand background and pull-to-refresh support. */
export function Screen({
  children,
  refreshing,
  onRefresh,
  contentStyle,
  scroll = true,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  scroll?: boolean;
}) {
  const c = useColors();
  const pageBg = useActivityPageBg();
  const bottomInset = Platform.OS === "web" ? 34 : 0;
  if (!scroll) {
    return (
      <View style={[styles.flex, { backgroundColor: pageBg }]}>
        <View style={[styles.screenContent, { paddingBottom: 24 + bottomInset }, contentStyle]}>
          {children}
        </View>
      </View>
    );
  }
  return (
    <KeyboardAwareScrollViewCompat
      style={[styles.flex, { backgroundColor: pageBg }]}
      contentContainerStyle={[
        styles.screenContent,
        { paddingBottom: 40 + bottomInset },
        contentStyle,
      ]}
      refreshControl={
        onRefresh
          ? (
            <RefreshControl
              refreshing={!!refreshing}
              onRefresh={onRefresh}
              tintColor={c.primary}
              colors={[c.primary]}
            />
          )
          : undefined
      }
      bottomOffset={20}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </KeyboardAwareScrollViewCompat>
  );
}

export function Kicker({ children, light }: { children: ReactNode; light?: boolean }) {
  const c = useColors();
  const { hi } = useLocale();
  return (
    <Text
      style={{
        fontFamily: bodyFamily(hi, "semibold"),
        fontSize: 12,
        letterSpacing: 1.6,
        textTransform: "uppercase",
        color: light ? "rgba(255,255,255,0.75)" : c.primary,
      }}
    >
      {children}
    </Text>
  );
}

export function Title({
  children,
  style,
  light,
  numberOfLines,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  light?: boolean;
  numberOfLines?: number;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const theme = useActivityTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          fontFamily: displayFamily(hi),
          fontSize: 26,
          lineHeight: 32,
          color: light ? "#FFFFFF" : (theme?.inkStrong ?? c.secondary),
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Amounts, stats, dates, OTP — DM Mono. Optional count-up for home punya. */
export function Numeric({
  children,
  style,
  medium,
  countUp,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  medium?: boolean;
  /** When true and children is a finite number, animate via Reanimated. */
  countUp?: boolean;
}) {
  const c = useColors();
  const target =
    typeof children === "number"
      ? children
      : typeof children === "string" && Number.isFinite(Number(children))
        ? Number(children)
        : null;

  const progress = useSharedValue(countUp && target !== null ? 0 : (target ?? 0));
  const [display, setDisplay] = useState<ReactNode>(
    countUp && target !== null ? 0 : children,
  );
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (!countUp || target === null || reduceMotion || Platform.OS === "web") {
      setDisplay(children);
      progress.value = target ?? 0;
      return;
    }
    progress.value = withTiming(target, { duration: 700 });
  }, [children, countUp, progress, reduceMotion, target]);

  useAnimatedReaction(
    () => Math.round(progress.value),
    (current, previous) => {
      if (current !== previous) {
        runOnJS(setDisplay)(current);
      }
    },
    [countUp],
  );

  return (
    <Text
      style={[
        {
          fontFamily: medium ? fonts.monoMedium : fonts.mono,
          fontVariant: ["tabular-nums"],
          color: c.foreground,
        },
        style,
      ]}
    >
      {countUp && target !== null ? display : children}
    </Text>
  );
}

export function Body({
  children,
  style,
  muted,
  onPress,
  numberOfLines,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  muted?: boolean;
  onPress?: () => void;
  numberOfLines?: number;
}) {
  const c = useColors();
  const { hi } = useLocale();
  return (
    <Text
      onPress={onPress}
      numberOfLines={numberOfLines}
      style={[
        { fontFamily: bodyFamily(hi), fontSize: 15, lineHeight: 22, color: muted ? c.mutedForeground : c.foreground },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: c.card,
          borderRadius: c.radius,
          borderWidth: 1,
          borderColor: c.border,
          padding: 16,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Pill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "primary" | "success" | "warning" | "error" | "info";
}) {
  const c = useColors();
  const map: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: c.muted, fg: c.mutedForeground },
    primary: { bg: c.accent, fg: c.accentForeground },
    success: { bg: c.successSoft, fg: c.successText },
    warning: { bg: c.warningSoft, fg: c.warningText },
    error: { bg: c.errorSoft, fg: c.errorText },
    info: { bg: c.infoSoft, fg: c.infoText },
  };
  const t = map[tone];
  const { hi } = useLocale();
  return (
    <View style={{ alignSelf: "flex-start", backgroundColor: t.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
      {/* L4 — CLAUDE.md sets a 22px floor for any Devanagari text, because
          its ascenders and matras are taller than Latin. This was 11px with no
          lineHeight at all, so a tier badge reading जिज्ञासु had its matras
          clipped. Unconditional rather than keyed on `hi`: Jain terms stay in
          Devanagari even in the English locale, so the pill cannot know from
          the locale alone whether its label needs the taller line. */}
      <Text
        style={{
          fontFamily: bodyFamily(hi, "semibold"),
          fontSize: 11,
          lineHeight: 22,
          color: t.fg,
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
  compact,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "outline" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Tighter padding for dense rows (e.g. library Audio|Text|Video). */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const palettes: Record<string, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.primary, fg: c.primaryForeground },
    secondary: { bg: c.secondary, fg: c.secondaryForeground },
    outline: { bg: "transparent", fg: c.secondary, border: c.border },
    ghost: { bg: "transparent", fg: c.primary },
  };
  const p = palettes[variant];
  const isDisabled = disabled || loading;
  const { hi } = useLocale();
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPressIn={() => {
        if (isDisabled) return;
        scale.value = withTiming(0.97, { duration: 90 });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: 120 });
      }}
      onPress={() => {
        if (isDisabled) return;
        if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      disabled={isDisabled}
      style={style}
    >
      <Animated.View
        style={[
          {
            width: compact ? undefined : "100%",
            alignSelf: compact ? "flex-start" : undefined,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: compact ? 6 : 8,
            backgroundColor: p.bg,
            borderColor: p.border ?? "transparent",
            borderWidth: p.border ? 1 : 0,
            borderRadius: c.radius,
            paddingVertical: compact ? 8 : 13,
            paddingHorizontal: compact ? 8 : 18,
            opacity: isDisabled ? 0.5 : 1,
          },
          animStyle,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={p.fg} size="small" />
        ) : (
          <>
            {icon ? <Ionicons name={icon} size={compact ? 16 : 18} color={p.fg} /> : null}
            <Text
              numberOfLines={1}
              style={{
                fontFamily: bodyFamily(hi, "semibold"),
                fontSize: compact ? 13 : 15,
                color: p.fg,
                flexShrink: 1,
              }}
            >
              {label}
            </Text>
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}

export function StateView({
  status,
  emptyText,
  errorText,
  onRetry,
  retryLabel = "Try again",
}: {
  status: "loading" | "empty" | "error";
  emptyText: string;
  errorText?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const c = useColors();
  const { hi } = useLocale();
  if (status === "loading") {
    return (
      <View style={styles.stateBox}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }
  const icon = status === "error" ? "alert-circle-outline" : "leaf-outline";
  const text = status === "error" ? errorText ?? "Something went wrong." : emptyText;
  return (
    <View style={styles.stateBox}>
      <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={36} color={c.inkDim} />
      <Text style={{ fontFamily: bodyFamily(hi), fontSize: 15, color: c.mutedForeground, textAlign: "center", marginTop: 12, maxWidth: 280 }}>
        {text}
      </Text>
      {status === "error" && onRetry ? (
        <View style={{ marginTop: 16 }}>
          <Button label={retryLabel} variant="outline" onPress={onRetry} icon="refresh" />
        </View>
      ) : null}
    </View>
  );
}

/**
 * A determinate progress bar.
 *
 * `value` is 0..1; null renders the empty track, which is the honest thing to
 * show when progress is unknown rather than a full or empty bar that claims
 * something. Clamped, so a server value slightly over 1 cannot overflow the
 * track.
 */
export function ProgressBar({
  value,
  height = 6,
  tone,
}: {
  value: number | null;
  height?: number;
  /** Fill colour; defaults to the primary accent. */
  tone?: string;
}) {
  const c = useColors();
  const pct = value == null ? 0 : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <View
      style={{
        height,
        borderRadius: height,
        backgroundColor: c.muted,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          height,
          width: `${pct}%`,
          borderRadius: height,
          backgroundColor: tone ?? c.primary,
        }}
      />
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center" }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screenContent: { paddingHorizontal: 18, paddingTop: 8, gap: 14 },
  stateBox: { alignItems: "center", justifyContent: "center", paddingVertical: 48 },
});
