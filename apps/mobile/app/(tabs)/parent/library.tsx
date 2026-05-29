/**
 * Parent library tab — Step 22.
 *
 * Renders the access-tier-filtered library returned by GET /v1/library
 * with a per-row tile that respects the four content types (pdf / video /
 * audio / image). Tap → /library/[id] for the detail viewer (which
 * implements Q7's YouTube/Vimeo iframe rendering for video items).
 */

import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { libraryApi, type LibraryItemDto } from '@/api/endpoints/library';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

interface State {
  loading: boolean;
  items: LibraryItemDto[];
  error: string | null;
}

export default function ParentLibrary() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>({ loading: true, items: [], error: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await libraryApi.list({ limit: 50 });
      setState({ loading: false, items: res.items, error: null });
    } catch (err) {
      setState({
        loading: false,
        items: [],
        error: err instanceof ApiError ? err.message : 'Could not load library',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + JPSpacing.sp6 }]}>
        <ActivityIndicator color={JPColors.saffron} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + JPSpacing.sp6 }]}>
      <Text style={styles.heading}>Library</Text>
      <Text style={styles.subhead}>Audio, video, and reading curated for the family.</Text>
      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
      <FlatList
        data={state.items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ paddingBottom: JPSpacing.sp6 }}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => router.push(`/(parent)/library/${item.id}` as never)}
          >
            <View style={[styles.kindPill, kindPillColour(item.content_type)]}>
              <Text style={styles.kindText}>{item.content_type.toUpperCase()}</Text>
            </View>
            <Text style={styles.title}>{item.title_en}</Text>
            <Text style={styles.titleHi}>{item.title_hi}</Text>
            {item.msv_only ? <Text style={styles.msvFlag}>MSV only</Text> : null}
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No items available yet. Check back after your centre uploads something.
          </Text>
        }
      />
    </View>
  );
}

function kindPillColour(kind: LibraryItemDto['content_type']) {
  switch (kind) {
    case 'video':
      return { backgroundColor: JPColors.maroon50, borderColor: JPColors.maroon };
    case 'audio':
      return { backgroundColor: JPColors.gold50, borderColor: JPColors.gold };
    case 'image':
      return { backgroundColor: JPColors.saffron50, borderColor: JPColors.saffron };
    case 'pdf':
    default:
      return { backgroundColor: JPColors.creamDark, borderColor: JPColors.textSub };
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: JPColors.cream,
    paddingHorizontal: JPSpacing.sp6,
  },
  heading: {
    fontFamily: JPFonts.display,
    fontSize: 24,
    color: JPColors.maroon,
    marginBottom: 4,
  },
  subhead: {
    fontFamily: JPFonts.body,
    color: JPColors.textSub,
    fontSize: 13,
    marginBottom: JPSpacing.sp4,
  },
  card: {
    backgroundColor: JPColors.creamDark,
    borderRadius: JPRadius.lg,
    padding: JPSpacing.sp4,
    marginBottom: JPSpacing.sp2,
  },
  title: {
    fontFamily: JPFonts.display,
    fontSize: 16,
    color: JPColors.textPrimary,
    marginTop: 8,
  },
  titleHi: {
    fontFamily: JPFonts.display,
    fontSize: 14,
    color: JPColors.maroon,
    marginTop: 2,
  },
  kindPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  kindText: {
    fontFamily: JPFonts.body,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  msvFlag: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    color: JPColors.gold,
    marginTop: 6,
    fontWeight: '600',
  },
  empty: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    color: JPColors.textSub,
    paddingTop: JPSpacing.sp4,
  },
  error: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    color: JPColors.maroon,
    marginBottom: JPSpacing.sp2,
  },
});
