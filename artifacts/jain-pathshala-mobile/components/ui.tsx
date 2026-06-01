import { Ionicons } from "@expo/vector-icons";
import { type ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { bodyFamily, displayFamily, fonts } from "@/constants/typography";
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
  const bottomInset = Platform.OS === "web" ? 34 : 0;
  if (!scroll) {
    return (
      <View style={[styles.flex, { backgroundColor: c.background }]}>
        <View style={[styles.screenContent, { paddingBottom: 24 + bottomInset }, contentStyle]}>
          {children}
        </View>
      </View>
    );
  }
  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: c.background }]}
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
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
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
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  light?: boolean;
}) {
  const c = useColors();
  const { hi } = useLocale();
  return (
    <Text
      style={[
        { fontFamily: displayFamily(hi), fontSize: 26, lineHeight: 32, color: light ? "#FFFFFF" : c.secondary },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Amounts, stats, dates, OTP — DM Mono */
export function Numeric({
  children,
  style,
  medium,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  medium?: boolean;
}) {
  const c = useColors();
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
      {children}
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
      <Text style={{ fontFamily: bodyFamily(hi, "semibold"), fontSize: 11, color: t.fg, letterSpacing: 0.3 }}>{label}</Text>
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
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "outline" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
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
  return (
    <Pressable
      onPress={() => {
        if (isDisabled) return;
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          backgroundColor: p.bg,
          borderColor: p.border ?? "transparent",
          borderWidth: p.border ? 1 : 0,
          borderRadius: c.radius,
          paddingVertical: 13,
          paddingHorizontal: 18,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={p.fg} /> : null}
          <Text style={{ fontFamily: bodyFamily(hi, "semibold"), fontSize: 15, color: p.fg }}>{label}</Text>
        </>
      )}
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

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center" }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screenContent: { paddingHorizontal: 18, paddingTop: 8, gap: 14 },
  stateBox: { alignItems: "center", justifyContent: "center", paddingVertical: 48 },
});
