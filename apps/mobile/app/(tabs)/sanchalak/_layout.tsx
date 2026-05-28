import { Tabs } from 'expo-router';
import React from 'react';

import { tabScreenOptions } from '@/theme/tabs';

export default function SanchalakTabsLayout() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="dashboard" options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="centres" options={{ title: 'My centres' }} />
      <Tabs.Screen name="batches" options={{ title: 'Batches' }} />
      <Tabs.Screen name="reports" options={{ title: 'Reports' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
