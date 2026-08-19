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
import { TabBarInsetProvider } from "@/contexts/TabBarInsetContext";
import { LibraryDownloadItemLookup } from "@/components/LibraryDownloadItemLookup";
import { LibraryVersionSyncLoop } from "@/components/LibraryVersionSyncLoop";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineSyncLoop } from "@/components/OfflineSyncLoop";
import { AuthProvider } from "@/contexts/AuthContext";
import { persistOptions, queryClient } from "@/lib/query-client";
import { LocaleProvider, useLocale } from "@/contexts/LocaleContext";
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
  // Inside LocaleProvider — shared headers were English-only for a Hindi
  // guest even with the app set to हिन्दी (GST-DSN-01).
  const { hi } = useLocale();
  return (
    <Stack
      screenOptions={{
        headerBackTitle: hi ? "वापस" : "Back",
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
      <Stack.Screen name="centres" options={{ title: hi ? "केंद्र" : "Centres" }} />
      <Stack.Screen name="team/index" options={{ title: hi ? "टीम" : "Team" }} />
      <Stack.Screen name="team/[citySlug]" options={{ title: hi ? "टीम" : "Team" }} />
      <Stack.Screen name="shivirs" options={{ title: hi ? "शिविर" : "Shivirs" }} />
      <Stack.Screen name="notices" options={{ title: hi ? "सूचनाएँ" : "Notices" }} />
      <Stack.Screen name="centre/[id]" options={{ title: hi ? "केंद्र" : "Centre" }} />
      <Stack.Screen name="shivir/[id]" options={{ title: hi ? "शिविर" : "Shivir" }} />
      <Stack.Screen name="my-shivirs" options={{ title: hi ? "मेरे शिविर" : "My shivirs" }} />
      <Stack.Screen
        name="shivir-scan/[id]"
        options={{ title: hi ? "उपस्थिति स्कैन" : "Scan attendance" }}
      />
      <Stack.Screen
        name="attendance/[id]"
        options={{ title: hi ? "उपस्थिति दर्ज करें" : "Mark attendance" }}
      />
      <Stack.Screen name="info/[slug]" options={{ title: "" }} />
      <Stack.Screen name="gallery" options={{ title: hi ? "पुण्य गैलरी" : "Punya Wall" }} />
      {/* Wave 4 — new student/parent flows */}
      <Stack.Screen name="notifications" options={{ title: hi ? "इनबॉक्स" : "Inbox" }} />
      <Stack.Screen name="niyam-submit" options={{ title: hi ? "नियम भेजें" : "Submit Niyam" }} />
      <Stack.Screen
        name="niyam-submissions"
        options={{ title: hi ? "सभी प्रविष्टियाँ" : "All submissions" }}
      />
      <Stack.Screen name="homework" options={{ title: hi ? "गृहकार्य" : "Homework" }} />
      <Stack.Screen
        name="homework-assignment/[id]"
        options={{ title: hi ? "गृहकार्य समीक्षा" : "Review homework" }}
      />
      <Stack.Screen
        name="courses"
        options={{ headerShown: false, title: hi ? "पाठ्यक्रम" : "Courses" }}
      />
      <Stack.Screen
        name="course/[id]"
        options={{ headerShown: false, title: hi ? "पाठ्यक्रम" : "Course" }}
      />
      <Stack.Screen name="certificates" options={{ title: hi ? "प्रमाणपत्र" : "Certificates" }} />
      <Stack.Screen name="msv" options={{ title: "MSV" }} />
      <Stack.Screen name="enquire" options={{ headerShown: false }} />
      <Stack.Screen name="donate" options={{ headerShown: false }} />
      <Stack.Screen name="student-detail/[id]" options={{ title: hi ? "विद्यार्थी" : "Student" }} />
      <Stack.Screen name="my-attendance" options={{ title: hi ? "उपस्थिति" : "Attendance" }} />
      <Stack.Screen name="quizzes" options={{ title: hi ? "प्रश्नोत्तरी" : "Quizzes" }} />
      <Stack.Screen
        name="competitions"
        options={{ title: hi ? "प्रतियोगिताएँ" : "Competitions" }}
      />
      <Stack.Screen name="idcard" options={{ title: hi ? "आईडी कार्ड" : "ID Card" }} />
      {/* Phase 2 — new flows */}
      <Stack.Screen name="exams" options={{ title: hi ? "परीक्षाएँ" : "Exams" }} />
      <Stack.Screen
        name="service-requests"
        options={{ title: hi ? "मेरे अनुरोध" : "My requests" }}
      />
      <Stack.Screen name="service-request/[id]" options={{ title: hi ? "अनुरोध" : "Request" }} />
      <Stack.Screen name="library/index" options={{ title: hi ? "पुस्तकालय" : "Library" }} />
      <Stack.Screen name="library/[sectionId]" options={{ title: hi ? "पुस्तकालय" : "Library" }} />
      <Stack.Screen name="library/item/[itemId]" options={{ title: hi ? "पाठ" : "Text" }} />
      {/* The reader draws its own header (title + page counter + close), so
          the stack header would be a second bar over the same screen. */}
      <Stack.Screen name="library/pdf/[itemId]" options={{ headerShown: false }} />
      <Stack.Screen
        name="library/granth/library/[libraryId]"
        options={{ title: hi ? "पुस्तकालय" : "Library" }}
      />
      <Stack.Screen
        name="library/granth/entry/[entryId]"
        options={{ title: hi ? "ग्रंथ" : "Granth" }}
      />
      <Stack.Screen name="library/downloads" options={{ title: hi ? "डाउनलोड" : "Downloads" }} />
      <Stack.Screen name="library/bookmarks" options={{ title: hi ? "बुकमार्क" : "Bookmarks" }} />
      <Stack.Screen
        name="library/request"
        options={{ title: hi ? "सामग्री का अनुरोध" : "Request content" }}
      />
      <Stack.Screen
        name="library/my-requests"
        options={{ title: hi ? "मेरे अनुरोध" : "My requests" }}
      />
      <Stack.Screen name="panchang/index" options={{ title: hi ? "पंचांग" : "Panchang" }} />
      <Stack.Screen name="panchang/[date]" options={{ title: hi ? "दिन" : "Day" }} />
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
                    <TabBarInsetProvider>
                      <BottomSheetModalProvider>
                        <LibraryDownloadProvider>
                          <LibraryAudioProvider>
                            <OfflineSyncLoop />
                            <LibraryDownloadItemLookup />
                            <LibraryVersionSyncLoop hydrated={queryHydrated} />
                            <RootLayoutNav />
                            <LibraryMiniPlayer />
                            <LibraryFullPlayer />
                          </LibraryAudioProvider>
                        </LibraryDownloadProvider>
                      </BottomSheetModalProvider>
                    </TabBarInsetProvider>
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
