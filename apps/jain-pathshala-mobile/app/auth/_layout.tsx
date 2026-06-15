import { Stack } from "expo-router";
import { LanguageToggle } from "@/components/AppHeader";
import { fonts } from "@/constants/typography";
import colors from "@/constants/colors";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.light.background },
        headerTintColor: colors.light.secondary,
        headerTitleStyle: { fontFamily: fonts.display, color: colors.light.secondary },
        headerShadowVisible: false,
        headerBackTitle: "Back",
        headerRight: () => <LanguageToggle />,
        contentStyle: { backgroundColor: colors.light.background },
      }}
    >
      <Stack.Screen name="phone" options={{ title: "Sign in" }} />
      <Stack.Screen name="otp" options={{ title: "Enter code" }} />
    </Stack>
  );
}
