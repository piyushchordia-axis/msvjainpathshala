import {
  DMMono_400Regular,
  DMMono_500Medium,
} from "@expo-google-fonts/dm-mono";
import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  Outfit_800ExtraBold,
  Outfit_900Black,
} from "@expo-google-fonts/outfit";
import {
  Mukta_400Regular,
  Mukta_500Medium,
  Mukta_600SemiBold,
  Mukta_700Bold,
} from "@expo-google-fonts/mukta";
import { TiroDevanagariSanskrit_400Regular } from "@expo-google-fonts/tiro-devanagari-sanskrit";
import { useFonts } from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";
import type { Href } from "expo-router";
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
import { API_BASE } from "@/lib/api";
import { fonts } from "@/constants/typography";
import colors from "@/constants/colors";

SplashScreen.preventAutoHideAsync();

// Show banners/sounds even while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Best-effort deep link for a tapped notification. The server puts a `route`
 * (an explicit path) and/or a `kind` on the notification's data payload (see
 * the API's sendPush callers). Fall back to the in-app notifications inbox.
 */
function routeForNotificationData(data: unknown): Href {
  const d = (data ?? {}) as { route?: unknown; kind?: unknown };
  if (typeof d.route === "string" && d.route.startsWith("/")) {
    return d.route as Href;
  }
  return "/notifications";
}

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
      <Stack.Screen name="shivir-scan/[id]" options={{ title: "Scan attendance" }} />
      <Stack.Screen name="attendance/[id]" options={{ title: "Mark attendance" }} />
      <Stack.Screen name="info/[slug]" options={{ title: "" }} />
      <Stack.Screen name="gallery" options={{ title: "Punya Wall" }} />
      {/* Wave 4 — new student/parent flows */}
      <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
      <Stack.Screen name="niyam-submit" options={{ title: "Submit Niyam" }} />
      <Stack.Screen name="homework" options={{ title: "Homework" }} />
      <Stack.Screen name="quizzes" options={{ title: "Quizzes" }} />
      <Stack.Screen name="competitions" options={{ title: "Competitions" }} />
      <Stack.Screen name="idcard" options={{ title: "ID Card" }} />
      {/* Phase 2 — new flows */}
      <Stack.Screen name="exams" options={{ title: "Exams" }} />
      <Stack.Screen name="service-requests" options={{ title: "My requests" }} />
      <Stack.Screen name="service-request/[id]" options={{ title: "Request" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    Outfit_800ExtraBold,
    Outfit_900Black,
    DMMono_400Regular,
    DMMono_500Medium,
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

  useEffect(() => {
    if (__DEV__) {
      console.log("[Jain Pathshala] API_BASE =", API_BASE);
    }
  }, []);

  // Deep-link into the relevant screen when a push notification is tapped,
  // including the cold-start case where the tap launched the app.
  useEffect(() => {
    let mounted = true;

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (mounted && response) {
          router.push(
            routeForNotificationData(
              response.notification.request.content.data,
            ),
          );
        }
      })
      .catch(() => {});

    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        router.push(
          routeForNotificationData(response.notification.request.content.data),
        );
      },
    );

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <LocaleProvider>
                <AuthProvider>
                  <SessionViewProvider>
                    <RootLayoutNav />
                  </SessionViewProvider>
                </AuthProvider>
              </LocaleProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
