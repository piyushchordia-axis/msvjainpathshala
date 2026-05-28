/**
 * Shared screenOptions for Expo Router's <Tabs>.
 *
 * Approximates the look in `jp-design-system/preview/tabbar.html`:
 *   - cream background
 *   - 1px maroon-tinted top border
 *   - saffron active icon, maroon-300 inactive
 *   - Mukta 11px labels
 *
 * The custom TabBar component in `jp-design-system/expo/mobile/components.tsx`
 * can replace the default tab bar in a later polish pass — Step 8 keeps the
 * default for speed.
 */

import { JPColors, JPFonts } from '@/constants/colors';

import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';

export const tabScreenOptions: BottomTabNavigationOptions = {
  headerShown: false,
  tabBarStyle: {
    backgroundColor: JPColors.cream,
    borderTopColor: JPColors.border,
    borderTopWidth: 1,
    height: 64,
    paddingTop: 8,
    paddingBottom: 8,
  },
  tabBarActiveTintColor: JPColors.saffron,
  tabBarInactiveTintColor: JPColors.maroon300,
  tabBarLabelStyle: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    marginTop: 0,
  },
};
