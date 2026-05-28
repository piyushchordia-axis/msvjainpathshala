import { Tabs } from 'expo-router';
import React from 'react';

import { tabScreenOptions } from '@/theme/tabs';

export default function ShikshakTabsLayout() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="today" options={{ title: 'Today' }} />
      <Tabs.Screen name="batches" options={{ title: 'Batches' }} />
      <Tabs.Screen name="niyams" options={{ title: 'Niyams' }} />
      <Tabs.Screen name="library" options={{ title: 'Library' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
