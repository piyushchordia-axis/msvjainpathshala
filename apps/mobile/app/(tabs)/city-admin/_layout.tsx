import { Tabs } from 'expo-router';
import React from 'react';

import { tabIcon } from '@/theme/tab-icon';
import { useTabScreenOptions } from '@/theme/tabs';

export default function CityAdminTabsLayout() {
  return (
    <Tabs screenOptions={useTabScreenOptions()}>
      <Tabs.Screen name="dashboard" options={{ title: 'Dashboard', tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen name="centres" options={{ title: 'Centres', tabBarIcon: tabIcon('mapPin') }} />
      <Tabs.Screen
        name="operations"
        options={{ title: 'Operations', tabBarIcon: tabIcon('settings') }}
      />
      <Tabs.Screen name="reports" options={{ title: 'Reports', tabBarIcon: tabIcon('book') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon('user') }} />
    </Tabs>
  );
}
