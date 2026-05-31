import { Stack } from 'expo-router';
import React from 'react';

import { JPColors } from '@/constants/colors';

/**
 * Volunteer stack layout — Step 15.
 * Hosts the Shivir QR scanner flow (`/(volunteer)/scan/[shivirId]/[sessionId]`).
 */
export default function VolunteerStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: JPColors.cream },
      }}
    />
  );
}
