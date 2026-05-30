/**
 * AttendanceStatusChip — lowercase-API-status variant of `AttendanceChip`
 * from jp-components.tsx. Colour pairs copied verbatim from
 * `jp-design-system/preview/attendance-badges.html`.
 */

import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { JPColors, JPFonts } from '@/constants/colors';

import type { AttendanceStatus } from '@jp/shared';

const PALETTE: Record<AttendanceStatus, { bg: string; fg: string; label: string }> = {
  present: { bg: JPColors.successBg, fg: JPColors.success, label: 'Present' },
  absent: { bg: JPColors.errorBg, fg: JPColors.error, label: 'Absent' },
  late: { bg: JPColors.warningBg, fg: JPColors.warning, label: 'Late' },
  excused: { bg: JPColors.infoBg, fg: JPColors.info, label: 'Excused' },
};

const NOT_MARKED = { bg: JPColors.creamDark, fg: JPColors.textSub, label: 'Not marked' };

export interface AttendanceStatusChipProps {
  status: AttendanceStatus | null;
  size?: 'sm' | 'md';
  style?: ViewStyle;
}

export function AttendanceStatusChip({ status, size = 'md', style }: AttendanceStatusChipProps) {
  const m = status ? PALETTE[status] : NOT_MARKED;
  const padH = size === 'sm' ? 8 : 12;
  const padV = size === 'sm' ? 3 : 6;
  const font = size === 'sm' ? 11 : 13;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={m.label}
      style={[
        styles.chip,
        {
          backgroundColor: m.bg,
          paddingHorizontal: padH,
          paddingVertical: padV,
        },
        style,
      ]}
    >
      <Text style={[styles.label, { color: m.fg, fontSize: font }]}>{m.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontFamily: JPFonts.body,
    fontWeight: '600',
  },
});
