/**
 * `tabIcon(name)` — builds a `tabBarIcon` render function for Expo Router's
 * <Tabs.Screen> using the design-system `Icon` set (jp-components), so the
 * bottom bar shows real glyphs instead of React Navigation's default
 * placeholder. The lotus fills solid when its tab is active, matching
 * `jp-design-system/preview/tabbar.html`.
 */

import React from 'react';

import { Icon, type IconName } from '@/components/ui';

interface TabIconArgs {
  focused: boolean;
  color: string;
  size: number;
}

export function tabIcon(name: IconName) {
  function TabBarIcon({ focused, color, size }: TabIconArgs) {
    return (
      <Icon
        name={name}
        size={size ? Math.min(size, 24) : 22}
        color={color}
        fill={focused && name === 'lotus' ? 'solid' : 'none'}
      />
    );
  }
  return TabBarIcon;
}
