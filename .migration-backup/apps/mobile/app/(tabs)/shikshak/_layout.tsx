import { Tabs } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/ui';
import { TabBarBadge } from '@/components/ui/feedback';
import { useSyncIssuesStore } from '@/stores/sync-issues.store';
import { useSyncStore } from '@/stores/sync.store';
import { tabIcon } from '@/theme/tab-icon';
import { useTabScreenOptions } from '@/theme/tabs';

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

function PendingIcon({ color, size }: IconProps) {
  const pending = useSyncStore((s) => s.pending_count);
  const dim = size ? Math.min(size, 24) : 22;
  return (
    <View style={{ width: dim, height: dim, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="home" size={dim} color={color} />
      {pending > 0 ? (
        <View style={{ position: 'absolute', top: -2, right: -4 }}>
          <TabBarBadge dot variant="primary" size="sm" accessibilityLabel="Pending sync" />
        </View>
      ) : null}
    </View>
  );
}

function FailedIcon({ color, size }: IconProps) {
  const failed = useSyncIssuesStore((s) => s.failed_count);
  const dim = size ? Math.min(size, 24) : 22;
  return (
    <View style={{ width: dim, height: dim, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="user" size={dim} color={color} />
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
  return (
    <Tabs screenOptions={useTabScreenOptions()}>
      <Tabs.Screen
        name="today"
        options={{ title: 'Today', tabBarIcon: (p) => <PendingIcon {...p} /> }}
      />
      <Tabs.Screen name="batches" options={{ title: 'Batches', tabBarIcon: tabIcon('user') }} />
      <Tabs.Screen name="niyams" options={{ title: 'Niyams', tabBarIcon: tabIcon('flame') }} />
      <Tabs.Screen name="library" options={{ title: 'Library', tabBarIcon: tabIcon('book') }} />
      <Tabs.Screen name="punya" options={{ title: 'Punya', tabBarIcon: tabIcon('sparkles') }} />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: (p) => <FailedIcon {...p} /> }}
      />
    </Tabs>
  );
}
