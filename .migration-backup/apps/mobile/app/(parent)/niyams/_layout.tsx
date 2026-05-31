/**
 * Stack layout for the parent / student-view Niyams flows.
 *
 *   /(parent)/niyams              → "Today's Niyams" + "Active" + streaks
 *   /(parent)/niyams/[id]/submit  → camera/library picker + cream submit
 *
 * Background cream + saffron submit per DESIGN_GUIDE.md tone rules.
 */
import { Stack } from 'expo-router';
import React from 'react';

import { JPColors, JPFonts } from '@/constants/colors';

export default function NiyamsStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: JPColors.cream },
        headerTintColor: JPColors.maroon,
        headerTitleStyle: { fontFamily: JPFonts.display, fontWeight: '600' },
        contentStyle: { backgroundColor: JPColors.cream },
      }}
    />
  );
}
