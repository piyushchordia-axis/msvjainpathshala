import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { tokens } from '../tokens';

export type StreakState = 'live' | 'broken' | 'milestone';

export interface StreakBadgeProps {
  /** Current streak length. */
  days: number;
  /** Localized unit label e.g. "day streak" / "दिनों की लड़ी". */
  unitLabel: string;
  state?: StreakState;
  size?: 'sm' | 'md' | 'lg';
  /** Custom icon slot (Lucide flame, custom SVG, emoji <Text>, etc.). */
  icon?: React.ReactNode;
  /** Pulse the icon while live. */
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
}

const palette: Record<StreakState, { bg: string; fg: string }> = {
  live:      { bg: tokens.color.brand.saffron50,  fg: tokens.color.brand.saffron },
  broken:    { bg: tokens.color.brand.creamDark,  fg: tokens.color.text.dim },
  milestone: { bg: tokens.color.brand.gold50,     fg: tokens.color.brand.gold },
};

const sizing: Record<
  NonNullable<StreakBadgeProps['size']>,
  { padX: number; padY: number; num: number; unit: number; icon: number }
> = {
  sm: { padX: 8,  padY: 2, num: 12, unit: 11, icon: 12 },
  md: { padX: 10, padY: 4, num: 13, unit: 12, icon: 14 },
  lg: { padX: 12, padY: 6, num: 15, unit: 13, icon: 16 },
};

export function StreakBadge({
  days,
  unitLabel,
  state = 'live',
  size = 'md',
  icon,
  animate = true,
  style,
}: StreakBadgeProps) {
  const c = palette[state];
  const s = sizing[size];
  const pulse = useSharedValue(1);

  React.useEffect(() => {
    if (state === 'live' && animate) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.12, { duration: 480 }),
          withTiming(1.00, { duration: 480 }),
        ),
        -1,
        true,
      );
    } else {
      pulse.value = withTiming(1, { duration: tokens.motion.quick });
    }
  }, [state, animate, pulse]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`${days} ${unitLabel}`}
      style={[
        styles.badge,
        {
          backgroundColor: c.bg,
          paddingHorizontal: s.padX,
          paddingVertical: s.padY,
        },
        state === 'milestone' && styles.milestone,
        style,
      ]}
    >
      <Animated.View
        style={[
          {
            width: s.icon,
            height: s.icon,
            alignItems: 'center',
            justifyContent: 'center',
          },
          iconStyle,
        ]}
      >
        {icon}
      </Animated.View>

      {/* Nested Text — RN lays them out inline correctly. */}
      <Text style={{ color: c.fg }}>
        <Text style={[styles.num, { fontSize: s.num }]}>{days}</Text>
        <Text style={[styles.unit, { fontSize: s.unit }]}> {unitLabel}</Text>
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
  milestone: {
    borderWidth: 1,
    borderColor: tokens.color.brand.gold,
  },
  num: {
    fontFamily: tokens.font.bodyBold,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontFamily: tokens.font.body,
    opacity: 0.8,
  },
});
