import { Stack } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { fonts } from "@/constants/typography";
import { useLocale } from "@/contexts/LocaleContext";
import { LanguageToggle } from "@/components/AppHeader";
import { usePreferJoinHindi } from "@/lib/join";

export default function JoinLayout() {
  usePreferJoinHindi();
  const c = useColors();
  const { hi } = useLocale();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.background },
        headerTintColor: c.secondary,
        headerTitleStyle: { fontFamily: fonts.display, color: c.secondary },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.background },
        headerRight: () => <LanguageToggle />,
      }}
    >
      <Stack.Screen name="index" options={{ title: hi ? "जुड़ें" : "Join" }} />
      <Stack.Screen name="student" options={{ title: hi ? "विद्यार्थी" : "Student" }} />
      <Stack.Screen name="shikshak" options={{ title: hi ? "शिक्षक" : "Shikshak" }} />
      <Stack.Screen name="sanchalak" options={{ title: hi ? "संचालक" : "Sanchalak" }} />
      <Stack.Screen name="complete-payment" options={{ title: hi ? "भुगतान" : "Payment" }} />
    </Stack>
  );
}
