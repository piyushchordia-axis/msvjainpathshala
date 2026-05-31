import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { tokens } from '@/theme/rn-tokens';

export type HeatmapIntensity = 0 | 1 | 2 | 3 | 4;
export type HeatmapRamp = 'saffron' | 'success' | 'gold';

export interface CalendarHeatmapCellProps {
  /** 0 = empty; 1–4 = increasing intensity. */
  intensity: HeatmapIntensity;
  /** ISO date or any id; echoed back to onPress. */
  date: string;
  /**
   * Required localized label for screen readers,
   * e.g. "5 May 2026 — 3 sessions" / "५ मई २०२६ — ३ सत्र".
   */
  accessibilityLabel: string;
  today?: boolean;
  outsideMonth?: boolean;
  size?: 'xs' | 'sm' | 'md';
  ramp?: HeatmapRamp;
  onPress?: (date: string) => void;
  style?: StyleProp<ViewStyle>;
}

const cellSize: Record<NonNullable<CalendarHeatmapCellProps['size']>, number> = {
  xs: 10,
  sm: 12,
  md: 16,
};
const cellRadius: Record<NonNullable<CalendarHeatmapCellProps['size']>, number> = {
  xs: 3,
  sm: 4,
  md: tokens.radius.xs,
};

const ramps: Record<HeatmapRamp, [string, string, string, string, string]> = {
  saffron: [
    tokens.color.brand.creamDark,
    tokens.color.brand.saffron50,
    'rgba(232,160,106,0.55)', // saffron300 @ 55%
    tokens.color.brand.saffron300,
    tokens.color.brand.saffron,
  ],
  success: [
    tokens.color.brand.creamDark,
    tokens.color.semantic.successBg,
    'rgba(22,101,52,0.30)',
    'rgba(22,101,52,0.60)',
    tokens.color.semantic.success,
  ],
  gold: [
    tokens.color.brand.creamDark,
    tokens.color.brand.gold50,
    'rgba(230,194,107,0.55)',
    tokens.color.brand.gold300,
    tokens.color.brand.gold,
  ],
};

export function CalendarHeatmapCell({
  intensity,
  date,
  accessibilityLabel,
  today,
  outsideMonth,
  size = 'sm',
  ramp = 'saffron',
  onPress,
  style,
}: CalendarHeatmapCellProps) {
  const dim = cellSize[size];
  const r = cellRadius[size];
  const bg = ramps[ramp][intensity];

  const inner = (
    <View
      style={[
        {
          width: dim,
          height: dim,
          borderRadius: r,
          backgroundColor: bg,
        },
        outsideMonth && styles.outside,
      ]}
    />
  );

  // The "today" ring lives on a wrapper so the cell stays the same visual size
  // — RN's borderWidth grows the box, unlike CSS's box-shadow/outline.
  const content = today ? (
    <View
      style={[
        styles.ring,
        {
          padding: 2,
          borderRadius: r + 2,
        },
      ]}
    >
      {inner}
    </View>
  ) : (
    inner
  );

  if (!onPress) {
    return (
      <View accessibilityRole="text" accessibilityLabel={accessibilityLabel} style={style}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => onPress(date)}
      hitSlop={6}
      style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }, style]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ring: {
    borderWidth: 2,
    borderColor: tokens.color.brand.saffron,
    backgroundColor: tokens.color.surface.bg,
  },
  outside: { opacity: 0.4 },
});
