import { Tabs } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { TabBarBadge } from '@/components/ui/feedback';
import { JPColors } from '@/constants/colors';
import { useSyncIssuesStore } from '@/stores/sync-issues.store';
import { useSyncStore } from '@/stores/sync.store';
import { tabScreenOptions } from '@/theme/tabs';

/**
 * Step 14 — overlay the pending-ops dot on the Today tab (any queued work)
 * and a warning-coloured count on the Profile tab when failed-ops exist.
 * The badges read directly from the sync stores, so a successful drain
 * updates the icon without a re-render dance.
 *
 * `tabBarIcon` receives `{ focused, color, size }` from expo-router/RN
 * tabs; we mirror that contract via a small circle indicator with a
 * superimposed badge.
 */

type IconProps = { focused: boolean; color: string; size: number };

function dotStyle(color: string, size: number, focused: boolean) {
  return {
    width: size * 0.55,
    height: size * 0.55,
    borderRadius: size,
    backgroundColor: color,
    opacity: focused ? 1 : 0.55,
  } as const;
}

function PendingIcon({ focused, color, size }: IconProps) {
  const pending = useSyncStore((s) => s.pending_count);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={dotStyle(color, size, focused)} />
      {pending > 0 ? (
        <View style={{ position: 'absolute', top: 0, right: 0 }}>
          <TabBarBadge dot variant="primary" size="sm" accessibilityLabel="Pending sync" />
        </View>
      ) : null}
    </View>
  );
}

function FailedIcon({ focused, color, size }: IconProps) {
  const failed = useSyncIssuesStore((s) => s.failed_count);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={dotStyle(color, size, focused)} />
      {failed > 0 ? (
        <View style={{ position: 'absolute', top: -2, right: -4 }}>
          <TabBarBadge
            count={failed}
            variant="error"
            size="sm"
            accessibilityLabel={`${failed} sync issues`}
          />
        </View>
      ) : null}
    </View>
  );
}

export default function ShikshakTabsLayout() {
  void JPColors; // keep the import alive for downstream tweaks
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen
        name="today"
        options={{ title: 'Today', tabBarIcon: (p) => <PendingIcon {...p} /> }}
      />
      <Tabs.Screen name="batches" options={{ title: 'Batches' }} />
      <Tabs.Screen name="niyams" options={{ title: 'Niyams' }} />
      <Tabs.Screen name="library" options={{ title: 'Library' }} />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: (p) => <FailedIcon {...p} /> }}
      />
    </Tabs>
  );
}
