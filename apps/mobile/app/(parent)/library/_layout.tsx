/**
 * Parent library stack — hosts /(parent)/library/[id].tsx (the detail
 * viewer). The library tab lives at /(tabs)/parent/library.tsx; this
 * stack covers the per-item route opened by tapping a card.
 */

import { Stack } from 'expo-router';
import React from 'react';

export default function LibraryStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
