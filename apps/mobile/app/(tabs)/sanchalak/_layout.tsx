import { Tabs } from 'expo-router';
import React from 'react';

import { tabIcon } from '@/theme/tab-icon';
import { useTabScreenOptions } from '@/theme/tabs';

export default function SanchalakTabsLayout() {
  return (
    <Tabs screenOptions={useTabScreenOptions()}>
      <Tabs.Screen name="dashboard" options={{ title: 'Dashboard', tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen
        name="centres"
        options={{ title: 'My centres', tabBarIcon: tabIcon('mapPin') }}
      />
      <Tabs.Screen name="batches" options={{ title: 'Batches', tabBarIcon: tabIcon('user') }} />
      <Tabs.Screen name="reports" options={{ title: 'Reports', tabBarIcon: tabIcon('book') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon('settings') }} />
    </Tabs>
  );
}
