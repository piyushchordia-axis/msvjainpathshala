/**
 * Shared library-list surface used by the shikshak, student-view, and guest
 * "library" tabs.
 *
 *   - Authenticated callers → GET /v1/library (tier-filtered server-side).
 *   - Guests → GET /v1/public/library (public items only, no auth).
 *
 * Renders bilingual titles (picks _en / _hi via the active language) and a
 * content-type pill. Video items (Q7) show their embed host.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { libraryApi, type LibraryItemDto } from '@/api/endpoints/library';
import { DataScreen, Panel } from '@/components/admin/AdminScreen';
import { JPColors, JPFonts, JPRadius } from '@/constants/colors';
import { useLanguage } from '@/features/language/use-language';

function embedHost(url: string | null): string | null {
  if (!url) return null;
  if (/youtu\.?be/.test(url)) return 'YouTube';
  if (/vimeo/.test(url)) return 'Vimeo';
  return 'Video';
}

function TypePill({ type }: { type: LibraryItemDto['content_type'] }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{type}</Text>
    </View>
  );
}

export function LibraryList({
  title,
  subtitle,
  publicOnly = false,
}: {
  title: string;
  subtitle?: string;
  publicOnly?: boolean;
}) {
  const lang = useLanguage();
  const [items, setItems] = React.useState<LibraryItemDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const res = publicOnly
        ? await libraryApi.listPublic({ limit: 50 })
        : await libraryApi.list({ limit: 50 });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the library.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [publicOnly]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <DataScreen
      title={title}
      subtitle={subtitle}
      loading={loading}
      error={error}
      onRetry={() => {
        setLoading(true);
        void load();
      }}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      empty={items.length === 0}
      emptyTitle="Library is empty"
      emptyBody="No items are available to you yet. Check back soon."
    >
      {items.map((item) => {
        const itemTitle = lang === 'hi' && item.title_hi ? item.title_hi : item.title_en;
        const desc = lang === 'hi' ? item.description_hi : item.description_en;
        const host = item.content_type === 'video' ? embedHost(item.embed_url) : null;
        return (
          <Panel key={item.id}>
            <View style={styles.header}>
              <Text style={styles.title}>{itemTitle}</Text>
              <TypePill type={item.content_type} />
            </View>
            {desc ? (
              <Text style={styles.desc} numberOfLines={3}>
                {desc}
              </Text>
            ) : null}
            <View style={styles.metaRow}>
              {host ? <Text style={styles.meta}>{host}</Text> : null}
              {item.age_groups.length > 0 ? (
                <Text style={styles.meta}>{item.age_groups.join(', ')}</Text>
              ) : null}
              {item.msv_only ? (
                <Text style={[styles.meta, { color: JPColors.gold }]}>MSV</Text>
              ) : null}
            </View>
          </Panel>
        );
      })}
    </DataScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: { flex: 1, fontFamily: JPFonts.display, fontSize: 17, color: JPColors.maroon },
  desc: { fontFamily: JPFonts.body, fontSize: 13, color: JPColors.textSub },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  meta: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    color: JPColors.textSub,
    textTransform: 'capitalize',
  },
  pill: {
    backgroundColor: JPColors.saffron50,
    borderRadius: JPRadius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pillText: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: JPColors.saffron,
    textTransform: 'uppercase',
  },
});
