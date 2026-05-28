import { Stack } from 'expo-router';
import React from 'react';

import { JPColors } from '@/constants/colors';

/**
 * Stack layout for the shikshak's session-detail flow (Step 13).
 * Pushed over the tab bar from `(tabs)/shikshak/today.tsx`.
 */
export default function ShikshakStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: JPColors.cream },
      }}
    />
  );
}
