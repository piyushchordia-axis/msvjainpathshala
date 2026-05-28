/**
 * PlaceholderScreen — uniform "feature lands in step N" surface used by
 * every tab in Step 8. Each role's tab _layout owns the bottom-nav; this
 * component fills the body until the per-feature step replaces it.
 *
 * Tone follows DESIGN_GUIDE.md:
 *   - sentence case, no emoji
 *   - Mukta body, Tiro display for the title
 *   - copy addresses the user as "you"
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, Header } from '@/components/ui';
import { JPColors, JPSpacing } from '@/constants/colors';

export interface PlaceholderScreenProps {
  title: string;
  subtitle?: string;
  body?: string;
  emptyTitle?: string;
  emptyBody?: string;
}

export function PlaceholderScreen({
  title,
  subtitle,
  emptyTitle,
  emptyBody,
}: PlaceholderScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Header title={title} subtitle={subtitle} />
      <View style={styles.body}>
        <EmptyState
          title={emptyTitle ?? title}
          body={
            emptyBody ??
            'Nothing here yet. This screen lands in a later step; the shell is just making sure navigation, theming, and offline state all work first.'
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: JPColors.cream,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: JPSpacing.sp4,
  },
});
