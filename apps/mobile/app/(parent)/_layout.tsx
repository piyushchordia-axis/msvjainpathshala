/**
 * Stack layout for the modal parent flows that sit OUTSIDE the bottom tabs.
 *
 * Currently hosts `/students/new` (Step 11 photo upload). Future child
 * flows (transfer request, ID-card download view, etc.) will land here too.
 */
import { Stack } from 'expo-router';
import React from 'react';

export default function ParentStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        presentation: 'modal',
      }}
    />
  );
}
