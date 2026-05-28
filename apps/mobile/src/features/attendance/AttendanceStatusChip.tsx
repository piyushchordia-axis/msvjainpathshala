/**
 * AttendanceStatusChip — lowercase-API-status variant of `AttendanceChip`
 * from jp-components.tsx. Colour pairs copied verbatim from
 * `jp-design-system/preview/attendance-badges.html`.
 */

import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import type { AttendanceStatus } from '@jp/shared';

const PALETTE: Record<AttendanceStatus, { bg: string; fg: string; label: string }> = {
  present: { bg: '#DCEEDD', fg: '#166534', label: 'Present' },
  absent: { bg: '#FBE5E5', fg: '#B91C1C', label: 'Absent' },
  late: { bg: '#FBEED0', fg: '#B45309', label: 'Late' },
  excused: { bg: '#DDE3F4', fg: '#1E3A8A', label: 'Excused' },
};

const NOT_MARKED = { bg: '#F5EDE0', fg: '#8B6F5E', label: 'Not marked' };

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
    fontWeight: '600',
  },
});
