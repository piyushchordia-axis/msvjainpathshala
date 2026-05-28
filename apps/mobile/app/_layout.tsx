/**
 * Root layout — every screen mounts below this.
 *
 * Provider stack (outer → inner):
 *   1. SafeAreaProvider           — used by every screen for insets
 *   2. GestureHandlerRootView     — required for react-native-gesture-handler
 *   3. QueryClientProvider        — TanStack Query (no persistence on Step 8;
 *                                   query cache is in-memory until module
 *                                   processors land in later steps).
 *   4. AuthProvider               — boots auth state from MMKV + SecureStore
 *   5. NetworkProvider            — keeps `useNetworkStore` in sync with NetInfo
 *   6. ThemeProvider              — React Navigation `Theme` for headers / bg
 *   7. AppOfflineBanner           — top-of-screen banner when offline
 *   8. Stack                      — Expo Router root
 *
 * Font loading: Mukta (body), Tiro Devanagari Sanskrit (display), and
 * JetBrains Mono (OTP cells). Until they finish loading we render an empty
 * View — Expo Splash stays up during the gap.
 */

import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono';
import {
  useFonts as useMuktaFonts,
  Mukta_400Regular,
  Mukta_500Medium,
  Mukta_600SemiBold,
  Mukta_700Bold,
} from '@expo-google-fonts/mukta';
import { TiroDevanagariSanskrit_400Regular } from '@expo-google-fonts/tiro-devanagari-sanskrit';
import NetInfo from '@react-native-community/netinfo';
import { ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Side-effect import: initialise i18next + wire ky refresh handler.
import '@/i18n';
import '@/api/endpoints/auth';

import { AppOfflineBanner } from '@/components/AppOfflineBanner';
import { SyncToast } from '@/components/ui/feedback/SyncToast';
import { JPColors } from '@/constants/colors';
import { AuthProvider } from '@/features/auth/auth-context';
import { InAppToast } from '@/notifications/InAppToast';
import { useNetworkStore } from '@/stores/network.store';
import { JPNavTheme } from '@/theme/theme';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 60 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function NetworkProvider({ children }: { children: React.ReactNode }) {
  const setState = useNetworkStore((s) => s.setState);
  useEffect(() => {
    const unsub = NetInfo.addEventListener(setState);
    void NetInfo.fetch().then(setState);
    return () => unsub();
  }, [setState]);
  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded] = useMuktaFonts({
    Mukta_400Regular,
    Mukta_500Medium,
    Mukta_600SemiBold,
    Mukta_700Bold,
    TiroDevanagariSanskrit_400Regular,
    JetBrainsMono_400Regular,
  });

  useEffect(() => {
    if (fontsLoaded) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: JPColors.cream }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <NetworkProvider>
              <ThemeProvider value={JPNavTheme}>
                <StatusBar style="dark" backgroundColor={JPColors.cream} />
                <AppOfflineBanner />
                <InAppToast />
                <SyncToast />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: JPColors.cream },
                  }}
                />
              </ThemeProvider>
            </NetworkProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
