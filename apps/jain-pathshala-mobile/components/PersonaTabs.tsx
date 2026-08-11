import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { Platform, StyleSheet, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { roleAllowed, routeForRole } from "@/lib/roles";
import { Screen, StateView } from "@/components/ui";
import type { Role } from "@/lib/types";

export interface PersonaTab {
  name: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
}

/**
 * Role-guarded bottom-tab shell shared by every authenticated persona group.
 * Redirects to guest home when logged out, or to the user's own home when they
 * stray into a group they aren't allowed into.
 */
export function PersonaTabs({
  allowed,
  tabs,
  hide = [],
}: {
  allowed: Role[];
  tabs: PersonaTab[];
  /** File-based routes in this folder that must not appear as tabs. */
  hide?: string[];
}) {
  const c = useColors();
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <Screen scroll={false}>
        <StateView status="loading" emptyText="" />
      </Screen>
    );
  }
  if (!user) return <Redirect href="/guest/home" />;
  if (!roleAllowed(user.role, allowed)) return <Redirect href={routeForRole(user.role)} />;

  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
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
            <BlurView intensity={100} tint="light" style={StyleSheet.absoluteFill} />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: c.background }]} />
          ) : null,
      }}
    >
      {tabs.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarIcon: ({ color }) => <Ionicons name={t.icon} size={22} color={color} />,
          }}
        />
      ))}
      {hide.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}
