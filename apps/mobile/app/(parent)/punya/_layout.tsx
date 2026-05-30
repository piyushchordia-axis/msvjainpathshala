/**
 * Stack layout for the parent / student-view Punya flows.
 *
 *   /(parent)/punya              → balance card + child selector + recent txns
 *   /(parent)/punya/leaderboard  → scope tabs (Batch / Centre / City / National / MSV)
 *
 * Both screens sit OUTSIDE the bottom tabs so they push as a normal stack
 * rather than swapping the active tab — matches the design system's
 * "spiritual journey" framing (a one-way drill-down into the child's
 * record).
 */
import { Stack } from 'expo-router';
import React from 'react';

import { JPColors, JPFonts } from '@/constants/colors';

export default function PunyaStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: JPColors.cream },
        headerTintColor: JPColors.maroon,
        headerTitleStyle: { fontFamily: JPFonts.display, fontWeight: '600' },
        contentStyle: { backgroundColor: JPColors.cream },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Punya' }} />
      <Stack.Screen name="leaderboard" options={{ title: 'Leaderboard' }} />
    </Stack>
  );
}
