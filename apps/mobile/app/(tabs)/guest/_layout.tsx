import { Tabs } from 'expo-router';
import React from 'react';

import { tabScreenOptions } from '@/theme/tabs';

export default function GuestTabsLayout() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="centres" options={{ title: 'Browse centres' }} />
      <Tabs.Screen name="about" options={{ title: 'About' }} />
      <Tabs.Screen name="library" options={{ title: 'Library' }} />
      <Tabs.Screen name="signup" options={{ title: 'Sign up' }} />
    </Tabs>
  );
}
