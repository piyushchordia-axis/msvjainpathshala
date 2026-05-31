import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { tokens } from '../tokens';

export type TabBarBadgeVariant = 'primary' | 'error' | 'success';
export type TabBarBadgeSize = 'sm' | 'md';

export interface TabBarBadgeProps {
  /** Numeric count. If undefined and `dot` is false → renders nothing. */
  count?: number;
  /** Cap value before rendering "N+". Default 99. */
  max?: number;
  /** Force dot style — ignores `count`. */
  dot?: boolean;
  /** Localized aria label e.g. "3 unread notifications". */
  accessibilityLabel?: string;
  variant?: TabBarBadgeVariant;
  size?: TabBarBadgeSize;
  style?: StyleProp<ViewStyle>;
}

const variants: Record<TabBarBadgeVariant, { bg: string; fg: string }> = {
  primary: { bg: tokens.color.brand.saffron,   fg: '#FFFFFF' },
  error:   { bg: tokens.color.semantic.error,  fg: '#FFFFFF' },
  success: { bg: tokens.color.semantic.success, fg: '#FFFFFF' },
};

export function TabBarBadge({
  count,
  max = 99,
  dot,
  accessibilityLabel,
  variant = 'error',
  size = 'md',
  style,
}: TabBarBadgeProps) {
  const v = variants[variant];

  const isDot = !!dot || count === undefined;

  if (isDot) {
    return (
      <View
        accessibilityRole="text"
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.dot,
          size === 'sm' ? styles.dotSm : styles.dotMd,
          { backgroundColor: v.bg },
          style,
        ]}
      />
    );
  }

  if (typeof count !== 'number' || count <= 0) return null;

  const display = count > max ? `${max}+` : String(count);

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? display}
      style={[
        styles.pill,
        size === 'sm' ? styles.pillSm : styles.pillMd,
        { backgroundColor: v.bg },
        style,
      ]}
    >
      <Text
        numberOfLines={1}
        allowFontScaling={false}
        style={[
          styles.label,
          size === 'sm' ? styles.labelSm : styles.labelMd,
          { color: v.fg },
        ]}
      >
        {display}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  dotSm: { width: 8, height: 8 },
  dotMd: { width: 10, height: 10 },
  pill: {
    minWidth: 18,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSm: {
    height: 14,
    minWidth: 14,
    paddingHorizontal: 3,
  },
  pillMd: {
    height: 18,
    minWidth: 18,
    paddingHorizontal: 4,
  },
  label: {
    fontFamily: tokens.font.bodyBold,
    fontWeight: '700',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  labelSm: { fontSize: 9,  lineHeight: 11 },
  labelMd: { fontSize: 11, lineHeight: 13 },
});
