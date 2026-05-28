import { Tabs } from 'expo-router';
import React from 'react';

import { tabScreenOptions } from '@/theme/tabs';

export default function StateAdminTabsLayout() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="dashboard" options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="cities" options={{ title: 'Cities' }} />
      <Tabs.Screen name="reports" options={{ title: 'Reports' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
