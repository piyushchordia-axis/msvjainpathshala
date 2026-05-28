import { Tabs } from 'expo-router';
import React from 'react';

import { tabScreenOptions } from '@/theme/tabs';

export default function StudentViewTabsLayout() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="punya" options={{ title: 'Punya' }} />
      <Tabs.Screen name="niyams" options={{ title: 'Niyams' }} />
      <Tabs.Screen name="library" options={{ title: 'Library' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
