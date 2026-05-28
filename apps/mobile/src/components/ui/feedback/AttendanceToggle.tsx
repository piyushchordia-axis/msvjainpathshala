import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { tokens } from '@/theme/rn-tokens';

export type AttendanceState = 'present' | 'absent' | 'late';

export interface AttendanceToggleOption {
  value: AttendanceState;
  /** Localized label — comes from i18n. */
  label: string;
}

export interface AttendanceToggleProps {
  value: AttendanceState | null;
  onChange: (next: AttendanceState | null) => void;
  options: AttendanceToggleOption[];
  /** Tapping the selected pill clears it. */
  toggleable?: boolean;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Localized aria-label for the radio group container. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

const stateColor: Record<AttendanceState, string> = {
  present: tokens.color.semantic.success,
  absent: tokens.color.semantic.error,
  late: tokens.color.semantic.warning,
};

export function AttendanceToggle({
  value,
  onChange,
  options,
  toggleable = true,
  size = 'md',
  disabled,
  accessibilityLabel,
  style,
}: AttendanceToggleProps) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      style={[styles.group, disabled && styles.disabled, style]}
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <ToggleOption
            key={opt.value}
            label={opt.label}
            selected={selected}
            color={stateColor[opt.value]}
            size={size}
            disabled={disabled}
            onPress={() => onChange(selected && toggleable ? null : opt.value)}
          />
        );
      })}
    </View>
  );
}

function ToggleOption({
  label,
  selected,
  color,
  size,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  color: string;
  size: 'sm' | 'md';
  disabled?: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const bg = useSharedValue(selected ? 1 : 0);

  React.useEffect(() => {
    bg.value = withTiming(selected ? 1 : 0, { duration: tokens.motion.quick });
  }, [bg, selected]);

  const animated = useAnimatedStyle(() => ({
    backgroundColor: bg.value === 1 ? color : 'transparent',
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      onPressIn={() => {
        scale.value = withSpring(0.96, { damping: 18, stiffness: 280 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 12, stiffness: 220 });
      }}
      onPress={onPress}
    >
      <Animated.View
        style={[styles.option, size === 'sm' ? styles.optionSm : styles.optionMd, animated]}
      >
        <Text
          numberOfLines={1}
          style={[
            size === 'sm' ? styles.labelSm : styles.labelMd,
            { color: selected ? '#FFFFFF' : tokens.color.text.sub },
          ]}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing[1],
    padding: tokens.spacing[1],
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: tokens.color.surface.border,
    backgroundColor: tokens.color.brand.creamDark,
    alignSelf: 'flex-start',
  },
  disabled: { opacity: 0.5 },
  option: {
    borderRadius: tokens.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionSm: {
    paddingHorizontal: tokens.spacing[3],
    paddingVertical: tokens.spacing[1],
  },
  optionMd: {
    paddingHorizontal: tokens.spacing[4],
    paddingVertical: tokens.spacing[2],
  },
  labelSm: {
    ...tokens.type.caption,
    fontFamily: tokens.font.bodySemibold,
    fontWeight: '600',
  },
  labelMd: {
    ...tokens.type.label,
    fontFamily: tokens.font.bodySemibold,
    fontWeight: '600',
  },
});
