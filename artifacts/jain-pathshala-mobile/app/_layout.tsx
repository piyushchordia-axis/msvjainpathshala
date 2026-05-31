import {
  Mukta_400Regular,
  Mukta_500Medium,
  Mukta_600SemiBold,
  Mukta_700Bold,
} from "@expo-google-fonts/mukta";
import { TiroDevanagariSanskrit_400Regular } from "@expo-google-fonts/tiro-devanagari-sanskrit";
import { useFonts } from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LanguageToggle } from "@/components/AppHeader";
import { AuthProvider } from "@/contexts/AuthContext";
import { LocaleProvider } from "@/contexts/LocaleContext";
import { SessionViewProvider } from "@/contexts/SessionViewContext";
import { fonts } from "@/constants/typography";
import colors from "@/constants/colors";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerBackTitle: "Back",
        headerStyle: { backgroundColor: colors.light.background },
        headerTintColor: colors.light.secondary,
        headerTitleStyle: { fontFamily: fonts.display, color: colors.light.secondary },
        headerShadowVisible: false,
        headerRight: () => <LanguageToggle />,
        contentStyle: { backgroundColor: colors.light.background },
      }}
    >
      {/* Entry + persona tab groups (each owns its own header) */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="auth" options={{ headerShown: false }} />
      <Stack.Screen name="guest" options={{ headerShown: false }} />
      <Stack.Screen name="parent" options={{ headerShown: false }} />
      <Stack.Screen name="student" options={{ headerShown: false }} />
      <Stack.Screen name="shikshak" options={{ headerShown: false }} />
      <Stack.Screen name="admin" options={{ headerShown: false }} />

      {/* Shared detail screens (pushed from any persona) */}
      <Stack.Screen name="centre/[id]" options={{ title: "Centre" }} />
      <Stack.Screen name="shivir/[id]" options={{ title: "Shivir" }} />
      <Stack.Screen name="info/[slug]" options={{ title: "" }} />
      <Stack.Screen name="gallery" options={{ title: "Punya Wall" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    TiroDevanagariSanskrit_400Regular,
    Mukta_400Regular,
    Mukta_500Medium,
    Mukta_600SemiBold,
    Mukta_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <LocaleProvider>
            <AuthProvider>
              <SessionViewProvider>
                <GestureHandlerRootView>
                  <KeyboardProvider>
                    <RootLayoutNav />
                  </KeyboardProvider>
                </GestureHandlerRootView>
              </SessionViewProvider>
            </AuthProvider>
          </LocaleProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
