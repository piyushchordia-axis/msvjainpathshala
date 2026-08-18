import { useCallback } from "react";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs, useFocusEffect } from "expo-router";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { useSetTabBarInset } from "@/contexts/TabBarInsetContext";
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
  const insets = useSafeAreaInsets();
  const setTabBarInset = useSetTabBarInset();

  // React Navigation's default bar, plus whatever the device reserves below it.
  const barHeight = Platform.OS === "web" ? 84 : 49 + insets.bottom;

  /*
   * Publish the height only while this navigator is FOCUSED.
   *
   * The tabs layout stays mounted underneath a pushed stack screen, so keying
   * off mount would report a tab bar on screens that have none — which is the
   * bug being fixed. Focus is the thing that actually changes, and it needs no
   * list of route names to stay correct through a rename.
   */
  useFocusEffect(
    useCallback(() => {
      setTabBarInset(barHeight);
      return () => setTabBarInset(0);
    }, [barHeight, setTabBarInset]),
  );

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
