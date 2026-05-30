import { Tabs } from 'expo-router';
import React from 'react';

import { tabIcon } from '@/theme/tab-icon';
import { useTabScreenOptions } from '@/theme/tabs';

export default function ParentTabsLayout() {
  return (
    <Tabs screenOptions={useTabScreenOptions()}>
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen
        name="children"
        options={{ title: 'My children', tabBarIcon: tabIcon('user') }}
      />
      <Tabs.Screen
        name="attendance"
        options={{ title: 'Attendance', tabBarIcon: tabIcon('check') }}
      />
      <Tabs.Screen name="niyams" options={{ title: 'Niyams', tabBarIcon: tabIcon('flame') }} />
      <Tabs.Screen name="library" options={{ title: 'Library', tabBarIcon: tabIcon('book') }} />
      <Tabs.Screen
        name="notifications"
        options={{ title: 'Notifications', tabBarIcon: tabIcon('bell') }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon('settings') }} />
    </Tabs>
  );
}
