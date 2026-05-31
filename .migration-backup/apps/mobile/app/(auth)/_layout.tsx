/**
 * (auth) group — unauthenticated screens (phone + OTP). Cream bg, no
 * header. Per Step 8 design (jp-design-system/ui_kits/mobile/screens.jsx).
 */

import { Stack } from 'expo-router';
import React from 'react';

import { JPColors } from '@/constants/colors';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: JPColors.cream },
      }}
    />
  );
}
