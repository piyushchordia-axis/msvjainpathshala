import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { tokens } from '../tokens';

export type PunyaTier =
  | 'jigyasu'
  | 'shravak'
  | 'sadhak'
  | 'shraman'
  | 'tirthankar';

export interface PunyaTierBadgeProps {
  tier: PunyaTier;
  /** Localized name (e.g. "श्रावक" / "Shravak"). */
  label: string;
  withDot?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
}

/**
 * Solid pale tints — readable on cream surfaces AND on the dark maroon hero.
 * Avoid hex+opacity in RN: some Android paint pipelines round-trip alpha
 * inconsistently, so we ship pre-composited solids.
 */
const tints: Record<PunyaTier, string> = {
  jigyasu:    '#F1EAE0',
  shravak:    '#DCEEDD',
  sadhak:     '#DDE3F4',
  shraman:    '#F4E6E6',
  tirthankar: '#FAF1DC',
};

const sizing: Record<
  NonNullable<PunyaTierBadgeProps['size']>,
  { padX: number; padY: number; font: number; dot: number }
> = {
  sm: { padX: 8,  padY: 2, font: 11, dot: 5 },
  md: { padX: 10, padY: 4, font: 13, dot: 6 },
  lg: { padX: 12, padY: 6, font: 15, dot: 7 },
};

export function PunyaTierBadge({
  tier,
  label,
  withDot = true,
  size = 'md',
  style,
}: PunyaTierBadgeProps) {
  const color = tokens.color.tier[tier];
  const bg = tints[tier];
  const s = sizing[size];
  const isGold = tier === 'tirthankar';

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        styles.badge,
        {
          backgroundColor: bg,
          paddingHorizontal: s.padX,
          paddingVertical: s.padY,
        },
        isGold && styles.gold,
        style,
      ]}
    >
      {withDot ? (
        <View
          style={[
            styles.dot,
            { width: s.dot, height: s.dot, borderRadius: s.dot / 2, backgroundColor: color },
          ]}
        />
      ) : null}
      <Text
        numberOfLines={1}
        style={[styles.label, { color, fontSize: s.font }]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: tokens.radius.pill,
    alignSelf: 'flex-start',
  },
  gold: {
    borderWidth: 1,
    borderColor: tokens.color.brand.gold,
  },
  dot: {},
  label: {
    fontFamily: tokens.font.display,
  },
});
