import { Pressable, Text, View } from "react-native";
import { bodyFamily } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { Body, Title, useWebTopInset } from "@/components/ui";

/** EN / हिं switch — use on Profile (and auth/guest settings), not on every screen. */
export function LanguageToggle() {
  const { locale, toggleLocale } = useLocale();
  const c = useColors();
  return (
    <Pressable
      onPress={toggleLocale}
      style={{
        flexDirection: "row",
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 999,
        overflow: "hidden",
        backgroundColor: c.card,
      }}
    >
      <View style={{ paddingHorizontal: 11, paddingVertical: 5, backgroundColor: locale === "en" ? c.primary : "transparent" }}>
        <Text style={{ fontFamily: bodyFamily(false, "semibold"), fontSize: 12, color: locale === "en" ? c.primaryForeground : c.mutedForeground }}>
          EN
        </Text>
      </View>
      <View style={{ paddingHorizontal: 11, paddingVertical: 5, backgroundColor: locale === "hi" ? c.primary : "transparent" }}>
        <Text style={{ fontFamily: bodyFamily(true, "semibold"), fontSize: 12, color: locale === "hi" ? c.primaryForeground : c.mutedForeground }}>
          हिं
        </Text>
      </View>
    </Pressable>
  );
}

/** Custom in-screen header for tab screens (tabs render with headerShown: false). */
export function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const c = useColors();
  const top = useWebTopInset();
  return (
    <View style={{ paddingTop: top + 10, paddingHorizontal: 18, paddingBottom: 12, backgroundColor: c.background }}>
      <View>
        <Title>{title}</Title>
        {subtitle ? <Body muted style={{ marginTop: 3 }}>{subtitle}</Body> : null}
      </View>
    </View>
  );
}
