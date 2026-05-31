/**
 * NotificationsList — the in-app feed screen body.
 *
 * Matches `jp-design-system/ui_kits/mobile/screens.jsx` NoticesScreen
 * layout: cream background, saffron unread dot, ink text, bilingual.
 * Cursor pagination, pull-to-refresh.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { notificationsApi, type NotificationFeedItem } from '@/api/endpoints/notifications';
import { JPColors, JPRadius } from '@/constants/colors';
import { useLanguage } from '@/features/language/use-language';

function timeAgo(iso: string, language: 'en' | 'hi'): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const en = (n: number, single: string, plural: string) => `${n} ${n === 1 ? single : plural} ago`;
  const hi = (n: number, single: string) => `${n} ${single} पहले`;
  if (secs < 60) return language === 'hi' ? 'अभी' : 'Just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return language === 'hi' ? hi(mins, 'मिनट') : en(mins, 'minute', 'minutes');
  const hours = Math.floor(mins / 60);
  if (hours < 24) return language === 'hi' ? hi(hours, 'घंटे') : en(hours, 'hour', 'hours');
  const days = Math.floor(hours / 24);
  return language === 'hi' ? hi(days, 'दिन') : en(days, 'day', 'days');
}

export function NotificationsList(): React.JSX.Element {
  const language = useLanguage();
  const [items, setItems] = useState<NotificationFeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const loadInitial = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const page = await notificationsApi.list({ limit: 20 });
      setItems(page.items);
      setCursor(page.next_cursor);
      setHasMore(page.next_cursor !== null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || loading || refreshing || !cursor) return;
    setLoading(true);
    try {
      const page = await notificationsApi.list({ limit: 20, cursor });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.next_cursor);
      setHasMore(page.next_cursor !== null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [cursor, hasMore, loading, refreshing]);

  const onRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      const page = await notificationsApi.list({ limit: 20 });
      setItems(page.items);
      setCursor(page.next_cursor);
      setHasMore(page.next_cursor !== null);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const onPressItem = useCallback(async (id: string): Promise<void> => {
    try {
      const updated = await notificationsApi.markRead(id);
      setItems((prev) => prev.map((n) => (n.id === id ? updated : n)));
    } catch {
      /* swallow; UI stays consistent because we don't mutate optimistically */
    }
  }, []);

  const onMarkAllRead = useCallback(async (): Promise<void> => {
    try {
      await notificationsApi.markAllRead();
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const unread = useMemo(() => items.filter((i) => !i.is_read).length, [items]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{language === 'hi' ? 'सूचनाएँ' : 'Notifications'}</Text>
          {unread > 0 ? (
            <Text style={styles.subtitle}>
              {language === 'hi' ? `${unread} नई` : `${unread} unread`}
            </Text>
          ) : null}
        </View>
        {unread > 0 ? (
          <Pressable accessibilityRole="button" onPress={onMarkAllRead} hitSlop={6}>
            <Text style={styles.markAll}>{language === 'hi' ? 'सभी पढ़ी' : 'Mark all read'}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={JPColors.saffron} style={{ marginTop: 24 }} />
          ) : (
            <Text style={styles.empty}>
              {language === 'hi'
                ? 'अभी कोई सूचना नहीं — पुनः लोड करने के लिए नीचे खींचें।'
                : 'No notifications yet — pull down to refresh.'}
            </Text>
          )
        }
        ListFooterComponent={
          loading && items.length > 0 ? (
            <ActivityIndicator color={JPColors.saffron} style={{ paddingVertical: 12 }} />
          ) : null
        }
        renderItem={({ item }) => {
          const title = language === 'hi' ? item.title_hi : item.title_en;
          const body = language === 'hi' ? item.body_hi : item.body_en;
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => onPressItem(item.id)}
              style={[styles.card, !item.is_read && styles.cardUnread]}
            >
              <View style={styles.dotColumn}>
                {!item.is_read ? <View style={styles.dot} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, !item.is_read && styles.cardTitleUnread]}>
                  {title}
                </Text>
                {body ? (
                  <Text style={styles.cardBody} numberOfLines={3}>
                    {body}
                  </Text>
                ) : null}
                <Text style={styles.meta}>{timeAgo(item.created_at, language)}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: JPColors.cream },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: JPColors.maroon,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: JPColors.textSub,
  },
  markAll: {
    fontSize: 13,
    fontWeight: '600',
    color: JPColors.saffron,
  },
  error: {
    marginHorizontal: 16,
    marginBottom: 8,
    fontSize: 12,
    color: JPColors.error,
  },
  list: { paddingHorizontal: 16, paddingBottom: 80, paddingTop: 4 },
  separator: { height: 10 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.lg ?? 12,
    borderWidth: 1,
    borderColor: JPColors.border,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  cardUnread: { borderColor: JPColors.saffron50, backgroundColor: '#FFFFFF' },
  dotColumn: {
    width: 12,
    alignItems: 'center',
    paddingTop: 5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: JPColors.saffron,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: JPColors.textPrimary,
  },
  cardTitleUnread: {
    color: JPColors.maroon,
  },
  cardBody: {
    fontSize: 13,
    color: JPColors.textSub,
    lineHeight: 18,
    marginTop: 4,
  },
  meta: {
    marginTop: 6,
    fontSize: 11,
    color: JPColors.textSub,
  },
  empty: {
    paddingHorizontal: 24,
    paddingTop: 32,
    textAlign: 'center',
    fontSize: 13,
    color: JPColors.textSub,
  },
});
