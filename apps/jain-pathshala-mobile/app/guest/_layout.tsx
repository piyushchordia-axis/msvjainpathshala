import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";

type IoniconName = keyof typeof Ionicons.glyphMap;

export default function GuestLayout() {
  const c = useColors();
  const { hi } = useLocale();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  const tab = (name: string, title: string, icon: IoniconName) => (
    <Tabs.Screen
      name={name}
      options={{
        title,
        tabBarIcon: ({ color }) => <Ionicons name={icon} size={22} color={color} />,
      }}
    />
  );

  return (
    <Tabs
      initialRouteName="home"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.mutedForeground,
        tabBarLabelStyle: { fontSize: 11 },
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : c.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: c.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={100} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: c.background }]} />
          ) : null,
      }}
    >
      {/* Sign-in first — browsing tabs stay open for guests without an account. */}
      {tab("home", hi ? "साइन इन" : "Sign in", "log-in")}
      {tab("centres", hi ? "केंद्र" : "Centres", "location")}
      {tab("shivirs", hi ? "शिविर" : "Shivirs", "bonfire")}
      {tab("library", hi ? "पुस्तकालय" : "Library", "library")}
      {tab("notices", hi ? "घोषणाएँ" : "Notices", "megaphone")}
      {tab("more", hi ? "और" : "More", "ellipsis-horizontal")}
    </Tabs>
  );
}
