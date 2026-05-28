/**
 * Expo app config (SPEC §3.1, Step 8 prompt).
 *
 * Identity:
 *   - slug:    jain-pathshala
 *   - scheme:  jainpathshala  (deep-link prefix: jainpathshala://)
 *   - iOS:     org.jainpathshala.app
 *   - Android: org.jainpathshala.app
 *
 * Env:
 *   EXPO_PUBLIC_API_BASE_URL is read by `src/api/client.ts`. Defaults to
 *   http://localhost:3000 for the iOS simulator; Android emulator should
 *   set http://10.0.2.2:3000 (see README).
 *
 * Plugins land here as later mobile steps introduce native modules
 * (camera, location, barcode scanner, notifications). For Step 8 we keep
 * the surface minimal — only what the shell uses.
 */

import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Jain Pathshala',
  slug: 'jain-pathshala',
  scheme: 'jainpathshala',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  // Pre-launch placeholder icon & splash. Replace with the Enaa-supplied
  // assets once branding lands; the saffron-on-cream choice mirrors the
  // jp-design-system palette so the first render doesn't look out-of-brand.
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#D4621A',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'org.jainpathshala.app',
    config: {
      usesNonExemptEncryption: false,
    },
    infoPlist: {
      // Step 13 — shikshak GPS check-in (SPEC §8.2).
      NSLocationWhenInUseUsageDescription:
        'Jain Pathshala uses your location only when you check in to a session, to confirm you are at the centre.',
    },
  },
  android: {
    package: 'org.jainpathshala.app',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#D4621A',
    },
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
  },
  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/icon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Jain Pathshala uses your location only when you check in to a session, to confirm you are at the centre.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  // Surface env-driven values to JS via Constants.expoConfig.extra. The
  // EXPO_PUBLIC_* convention is auto-inlined by Metro at bundle time, but
  // we mirror them here for any code that reads via Constants.
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000',
    appEnv: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
  },
};

export default config;
