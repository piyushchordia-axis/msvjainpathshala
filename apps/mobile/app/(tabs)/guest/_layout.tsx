import { Tabs } from 'expo-router';
import React from 'react';

import { tabIcon } from '@/theme/tab-icon';
import { useTabScreenOptions } from '@/theme/tabs';

export default function GuestTabsLayout() {
  return (
    <Tabs screenOptions={useTabScreenOptions()}>
      <Tabs.Screen
        name="centres"
        options={{ title: 'Browse centres', tabBarIcon: tabIcon('mapPin') }}
      />
      <Tabs.Screen name="about" options={{ title: 'About', tabBarIcon: tabIcon('lotus') }} />
      <Tabs.Screen name="library" options={{ title: 'Library', tabBarIcon: tabIcon('book') }} />
      <Tabs.Screen name="signup" options={{ title: 'Sign up', tabBarIcon: tabIcon('plus') }} />
    </Tabs>
  );
}
