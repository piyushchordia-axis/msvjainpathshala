import { Tabs } from 'expo-router';
import React from 'react';

import { tabScreenOptions } from '@/theme/tabs';

export default function ParentTabsLayout() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="children" options={{ title: 'My children' }} />
      <Tabs.Screen name="niyams" options={{ title: 'Niyams' }} />
      <Tabs.Screen name="library" options={{ title: 'Library' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
