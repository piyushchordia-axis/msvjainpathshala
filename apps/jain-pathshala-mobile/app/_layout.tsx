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
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { router, Stack } from "expo-router";
import type { Href } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { LibraryDownloadProvider } from "@/contexts/LibraryDownloadContext";
import { LibraryAudioProvider } from "@/contexts/LibraryAudioContext";
import { LibraryFullPlayer, LibraryMiniPlayer } from "@/components/LibraryMiniPlayer";
import { LibraryDownloadItemLookup } from "@/components/LibraryDownloadItemLookup";
import { LibraryVersionSyncLoop } from "@/components/LibraryVersionSyncLoop";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineSyncLoop } from "@/components/OfflineSyncLoop";
import { AuthProvider } from "@/contexts/AuthContext";
import { persistOptions, queryClient } from "@/lib/query-client";
import { LocaleProvider } from "@/contexts/LocaleContext";
import { SessionViewProvider } from "@/contexts/SessionViewContext";
import { API_BASE } from "@/lib/api";
import { isExpoGo } from "@/lib/expo-go";
import { fonts } from "@/constants/typography";
import colors from "@/constants/colors";

SplashScreen.preventAutoHideAsync();

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

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerBackTitle: "Back",
        headerStyle: { backgroundColor: colors.light.background },
        headerTintColor: colors.light.secondary,
        headerTitleStyle: { fontFamily: fonts.display, color: colors.light.secondary },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.light.background },
      }}
    >
      {/* Entry + persona tab groups (each owns its own header) */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="auth" options={{ headerShown: false }} />
      <Stack.Screen name="guest" options={{ headerShown: false }} />
      <Stack.Screen name="join" options={{ headerShown: false }} />
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
      <Stack.Screen name="niyam-submissions" options={{ title: "All submissions" }} />
      <Stack.Screen name="homework" options={{ title: "Homework" }} />
      <Stack.Screen name="homework-assignment/[id]" options={{ title: "Review homework" }} />
      <Stack.Screen name="courses" options={{ title: "Courses" }} />
      <Stack.Screen name="course/[id]/index" options={{ title: "Course" }} />
      <Stack.Screen
        name="course/[id]/section/[sectionId]"
        options={{ title: "Section" }}
      />
      <Stack.Screen name="certificates" options={{ title: "Certificates" }} />
      <Stack.Screen name="student-detail/[id]" options={{ title: "Student" }} />
      <Stack.Screen name="my-attendance" options={{ title: "Attendance" }} />
      <Stack.Screen name="quizzes" options={{ title: "Quizzes" }} />
      <Stack.Screen name="competitions" options={{ title: "Competitions" }} />
      <Stack.Screen name="idcard" options={{ title: "ID Card" }} />
      {/* Phase 2 — new flows */}
      <Stack.Screen name="exams" options={{ title: "Exams" }} />
      <Stack.Screen name="service-requests" options={{ title: "My requests" }} />
      <Stack.Screen name="service-request/[id]" options={{ title: "Request" }} />
      <Stack.Screen name="library/[sectionId]" options={{ title: "Library" }} />
      <Stack.Screen name="library/item/[itemId]" options={{ title: "Text" }} />
      <Stack.Screen name="library/downloads" options={{ title: "Downloads" }} />
      <Stack.Screen name="panchang/index" options={{ title: "Panchang" }} />
      <Stack.Screen name="panchang/[date]" options={{ title: "Day" }} />
    </Stack>
  );
}

export default function RootLayout() {
  // PERF #24 — block splash on three faces only; load the rest after first paint.
  const [fontsLoaded, fontError] = useFonts({
    Outfit_400Regular,
    Outfit_700Bold,
    Mukta_400Regular,
  });
  const [queryHydrated, setQueryHydrated] = useState(false);

  const [extraFontsLoaded] = useFonts({
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_800ExtraBold,
    Outfit_900Black,
    DMMono_400Regular,
    DMMono_500Medium,
    TiroDevanagariSanskrit_400Regular,
    Mukta_500Medium,
    Mukta_600SemiBold,
    Mukta_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Extra faces load in the background; no splash gate.
  void extraFontsLoaded;

  useEffect(() => {
    if (__DEV__) {
      console.log("[Jain Pathshala] API_BASE =", API_BASE, "isExpoGo =", isExpoGo);
    }
  }, []);

  // Configure the foreground handler and deep-link into the relevant screen
  // when a push notification is tapped (including the cold-start case where the
  // tap launched the app). expo-notifications is imported lazily and only on
  // native outside Expo Go: in Expo Go it is unavailable (SDK 53+), and on web
  // getLastNotificationResponseAsync throws outright.
  useEffect(() => {
    if (isExpoGo || Platform.OS === "web") return;
    let mounted = true;
    let sub: { remove: () => void } | undefined;

    void (async () => {
      try {
        const Notifications = await import("expo-notifications");

        // Show banners/sounds even while the app is foregrounded.
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
        });

        const response = await Notifications.getLastNotificationResponseAsync();
        if (mounted && response) {
          router.push(
            routeForNotificationData(response.notification.request.content.data),
          );
        }

        sub = Notifications.addNotificationResponseReceivedListener((res) => {
          router.push(
            routeForNotificationData(res.notification.request.content.data),
          );
        });
      } catch (err) {
        // Notification deep-linking is a nicety: never let it take down boot.
        if (__DEV__) console.warn("[notifications] setup skipped:", err);
      }
    })();

    return () => {
      mounted = false;
      sub?.remove();
    };
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={persistOptions}
          onSuccess={() => setQueryHydrated(true)}
        >
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <LocaleProvider>
                <AuthProvider>
                  <SessionViewProvider>
                    <BottomSheetModalProvider>
                      <LibraryDownloadProvider>
                        <LibraryAudioProvider>
                          <OfflineSyncLoop />
                          <LibraryDownloadItemLookup />
                          <LibraryVersionSyncLoop hydrated={queryHydrated} />
                          <RootLayoutNav />
                          <LibraryMiniPlayer bottomOffset={64} />
                          <LibraryFullPlayer />
                        </LibraryAudioProvider>
                      </LibraryDownloadProvider>
                    </BottomSheetModalProvider>
                  </SessionViewProvider>
                </AuthProvider>
              </LocaleProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </PersistQueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
