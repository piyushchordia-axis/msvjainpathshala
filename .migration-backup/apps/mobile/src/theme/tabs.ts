/**
 * Shared screenOptions for Expo Router's <Tabs>.
 *
 * Approximates the look in `jp-design-system/preview/tabbar.html`:
 *   - cream background
 *   - 1px maroon-tinted top border
 *   - saffron active icon, maroon-300 inactive
 *   - Mukta 11px labels
 *
 * `useTabScreenOptions()` is safe-area aware: the bar height grows by the
 * bottom inset and the label keeps a fixed line-height so it never clips on
 * devices with a home indicator (or in the narrow web preview). Prefer it
 * over the static `tabScreenOptions` in every <Tabs> layout.
 */

import { useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { JPColors, JPFonts } from '@/constants/colors';

import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';

/** Visual height of the bar *excluding* the bottom safe-area inset. */
const BAR_CONTENT_HEIGHT = 62;

export function useTabScreenOptions(): BottomTabNavigationOptions {
  const insets = useSafeAreaInsets();
  return useMemo<BottomTabNavigationOptions>(
    () => ({
      headerShown: false,
      tabBarStyle: {
        backgroundColor: JPColors.cream,
        borderTopColor: JPColors.border,
        borderTopWidth: 1,
        height: BAR_CONTENT_HEIGHT + insets.bottom,
        paddingTop: 8,
        // Honour the home-indicator inset; keep a sensible floor when there's
        // none (web / older devices) so the label has breathing room.
        paddingBottom: Math.max(insets.bottom, 10),
      },
      tabBarActiveTintColor: JPColors.saffron,
      tabBarInactiveTintColor: JPColors.maroon300,
      tabBarIconStyle: { marginTop: 2 },
      tabBarLabelStyle: {
        fontFamily: JPFonts.body,
        fontSize: 11,
        lineHeight: 14,
        marginTop: 2,
      },
    }),
    [insets.bottom],
  );
}

/**
 * Static fallback (no safe-area inset). Retained for any non-hook caller; new
 * layouts should use `useTabScreenOptions()` so labels never clip.
 */
export const tabScreenOptions: BottomTabNavigationOptions = {
  headerShown: false,
  tabBarStyle: {
    backgroundColor: JPColors.cream,
    borderTopColor: JPColors.border,
    borderTopWidth: 1,
    height: BAR_CONTENT_HEIGHT,
    paddingTop: 8,
    paddingBottom: 10,
  },
  tabBarActiveTintColor: JPColors.saffron,
  tabBarInactiveTintColor: JPColors.maroon300,
  tabBarIconStyle: { marginTop: 2 },
  tabBarLabelStyle: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
  },
};
