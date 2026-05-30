import { Tabs } from 'expo-router';
import React from 'react';

import { tabIcon } from '@/theme/tab-icon';
import { useTabScreenOptions } from '@/theme/tabs';

export default function StudentViewTabsLayout() {
  return (
    <Tabs screenOptions={useTabScreenOptions()}>
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen name="punya" options={{ title: 'Punya', tabBarIcon: tabIcon('lotus') }} />
      <Tabs.Screen name="niyams" options={{ title: 'Niyams', tabBarIcon: tabIcon('flame') }} />
      <Tabs.Screen name="library" options={{ title: 'Library', tabBarIcon: tabIcon('book') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon('user') }} />
    </Tabs>
  );
}
