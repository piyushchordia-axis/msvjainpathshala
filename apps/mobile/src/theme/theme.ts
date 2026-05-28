/**
 * Navigation theme shim — feeds tokens into the (small) handful of
 * React Navigation / Expo Router surfaces that read from a `Theme` object
 * (header bar, default screen bg, scene transition tint).
 *
 * For the rest of the UI we use `JPColors` directly from `@/constants/colors`
 * via `StyleSheet.create()` — no theme context lookup required.
 */

import { JPColors } from '@/constants/colors';

import type { Theme } from '@react-navigation/native';

export const JPNavTheme: Theme = {
  dark: false,
  colors: {
    primary: JPColors.saffron,
    background: JPColors.cream,
    card: '#FFFFFF',
    text: JPColors.textPrimary,
    border: JPColors.border,
    notification: JPColors.maroon,
  },
  fonts: {
    regular: { fontFamily: 'Mukta_400Regular', fontWeight: '400' },
    medium: { fontFamily: 'Mukta_500Medium', fontWeight: '500' },
    bold: { fontFamily: 'Mukta_700Bold', fontWeight: '700' },
    heavy: { fontFamily: 'Mukta_700Bold', fontWeight: '700' },
  },
};
