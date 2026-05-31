import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";

import { useColors } from "@/hooks/useColors";

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="centres">
        <Icon sf={{ default: "mappin.and.ellipse", selected: "mappin.and.ellipse" }} />
        <Label>Centres</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="shivirs">
        <Icon sf={{ default: "tent", selected: "tent.fill" }} />
        <Label>Shivirs</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="notices">
        <Icon sf={{ default: "bell", selected: "bell.fill" }} />
        <Label>Notices</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <Icon sf={{ default: "ellipsis.circle", selected: "ellipsis.circle.fill" }} />
        <Label>More</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

type IoniconName = keyof typeof Ionicons.glyphMap;

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  const tab = (
    name: string,
    title: string,
    ionicon: IoniconName,
    sf: string,
  ) => (
    <Tabs.Screen
      name={name}
      options={{
        title,
        tabBarIcon: ({ color }) =>
          isIOS ? (
            <SymbolView name={sf as never} tintColor={color} size={24} />
          ) : (
            <Ionicons name={ionicon} size={22} color={color} />
          ),
      }}
    />
  );

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarLabelStyle: { fontSize: 11 },
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={100} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
          ) : null,
      }}
    >
      {tab("index", "Home", "home", "house")}
      {tab("centres", "Centres", "location", "mappin.and.ellipse")}
      {tab("shivirs", "Shivirs", "bonfire", "tent")}
      {tab("notices", "Notices", "notifications", "bell")}
      {tab("more", "More", "ellipsis-horizontal", "ellipsis.circle")}
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
