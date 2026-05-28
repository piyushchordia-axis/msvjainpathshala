import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { tokens } from '@/theme/rn-tokens';

export type NotificationKind = 'notice' | 'punya' | 'attendance' | 'system';

export interface NotificationItemProps {
  /** Localized title. */
  title: string;
  /** Localized body / preview. */
  body?: string;
  /** Already-formatted localized time, e.g. "2 hr ago" / "अभी". */
  timeLabel: string;
  read?: boolean;
  kind?: NotificationKind;
  /** Replace the leading slot (avatar, icon, custom dot). */
  leading?: React.ReactNode;
  /** Trailing slot for action buttons or metadata. */
  trailing?: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

const kindColor: Record<NotificationKind, string> = {
  notice: tokens.color.brand.saffron,
  punya: tokens.color.brand.gold,
  attendance: tokens.color.semantic.success,
  system: tokens.color.text.sub,
};

export function NotificationItem({
  title,
  body,
  timeLabel,
  read,
  kind = 'notice',
  leading,
  trailing,
  onPress,
  style,
}: NotificationItemProps) {
  const content = (
    <>
      <View style={styles.leading}>
        {leading ?? <View style={[styles.dot, { backgroundColor: kindColor[kind] }]} />}
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text
            numberOfLines={1}
            style={[styles.title, read ? styles.titleRead : styles.titleUnread]}
          >
            {title}
          </Text>
          <Text style={styles.time} numberOfLines={1}>
            {timeLabel}
          </Text>
        </View>

        {body ? (
          <Text style={styles.bodyText} numberOfLines={2}>
            {body}
          </Text>
        ) : null}
      </View>

      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </>
  );

  if (!onPress) {
    return (
      <View
        accessibilityRole="text"
        accessibilityLabel={title}
        accessibilityHint={body}
        style={[styles.row, !read && styles.unread, style]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={body}
      accessibilityState={{ selected: !read }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !read && styles.unread,
        pressed && styles.pressed,
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: tokens.spacing[3],
    paddingHorizontal: tokens.spacing[4],
    paddingVertical: tokens.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.surface.divider,
    backgroundColor: tokens.color.surface.card,
  },
  unread: {
    backgroundColor: tokens.color.brand.saffron50,
  },
  pressed: {
    backgroundColor: tokens.color.brand.creamDark,
  },
  leading: {
    marginTop: 6,
    width: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: tokens.spacing[2],
  },
  title: {
    ...tokens.type.body,
    flex: 1,
    color: tokens.color.text.primary,
  },
  titleRead: {
    fontFamily: tokens.font.bodyMedium,
    fontWeight: '500',
  },
  titleUnread: {
    fontFamily: tokens.font.bodySemibold,
    fontWeight: '600',
  },
  time: {
    ...tokens.type.caption,
    color: tokens.color.text.sub,
  },
  bodyText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: tokens.font.body,
    color: tokens.color.text.sub,
    marginTop: 2,
  },
  trailing: {
    marginLeft: tokens.spacing[2],
  },
});
