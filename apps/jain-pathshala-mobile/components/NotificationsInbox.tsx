import { useCallback, useState } from "react";
import { router } from "expo-router";
import { FlatList, Platform, Pressable, RefreshControl, View, type ListRenderItem } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  type NotificationRow,
} from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { routeForNotificationData } from "@/lib/notification-routing";
import { Body, Button, Card, Pill, Row, StateView, Title } from "@/components/ui";

/** In-app notification inbox list (no page chrome — used inside the hub). */
export function NotificationsInbox() {
  const c = useColors();
  const { hi } = useLocale();
  const notifications = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const rows = notifications.data?.items ?? [];
  const unreadCount = notifications.data?.unread_count ?? 0;

  // P-3 (review 2026-08) — a single global markRead.isPending gate meant one
  // in-flight mutation silently swallowed every other row's tap. Per-row
  // pending state instead.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const onPressRow = useCallback(
    (item: NotificationRow) => {
      const isUnread = !item.read_at;
      // P-4 (review 2026-08) — the row was a dead end: it only marked read,
      // never tapped through. `data` (X-9) is now persisted server-side, so
      // route on it the same way a push tap does.
      if (isUnread && !pendingIds.has(item.id)) {
        setPendingIds((prev) => new Set(prev).add(item.id));
        markRead.mutate(
          { id: item.id },
          {
            onSettled: () =>
              setPendingIds((prev) => {
                const next = new Set(prev);
                next.delete(item.id);
                return next;
              }),
          },
        );
      }
      router.push(routeForNotificationData({ kind: item.kind, ...item.data }));
    },
    [markRead, pendingIds],
  );

  const onRefresh = useCallback(() => {
    void notifications.refetch();
  }, [notifications]);

  const renderItem: ListRenderItem<NotificationRow> = useCallback(
    ({ item }) => {
      const isUnread = !item.read_at;
      const title = hi ? item.title_hi ?? item.title_en : item.title_en;
      const body = hi ? item.body_hi ?? item.body_en : item.body_en;
      return (
        <Pressable
          onPress={() => onPressRow(item)}
          // P-12 (review 2026-08) — a bare Pressable with no role/label/state;
          // once read it announced as a disabled control with no explanation.
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ selected: isUnread }}
        >
          <Card
            style={
              isUnread ? { borderColor: c.primary, backgroundColor: c.accent } : undefined
            }
          >
            <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Title style={{ fontSize: 16 }}>{title}</Title>
                <Body muted style={{ fontSize: 11, marginTop: 2 }}>
                  {formatDate(item.created_at, hi)}
                </Body>
              </View>
              {isUnread ? <Pill label={hi ? "नया" : "New"} tone="primary" /> : null}
            </Row>
            {body ? (
              <Body muted={!isUnread} style={{ marginTop: 8 }}>
                {body}
              </Body>
            ) : null}
          </Card>
        </Pressable>
      );
    },
    [c.accent, c.primary, hi, onPressRow],
  );

  const keyExtractor = useCallback((item: NotificationRow) => item.id, []);

  if (notifications.isLoading) {
    return (
      <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
        <StateView status="loading" emptyText="" />
      </View>
    );
  }

  // P-2 (review 2026-08) — a rejected fetchNextPage also sets the infinite
  // query's single error slot, which previously discarded the 50 rows
  // already on screen and replaced them with a full-screen error. Only show
  // the full-screen state when there is truly nothing to show.
  if (notifications.isError && !notifications.data) {
    return (
      <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
        <StateView
          status="error"
          emptyText=""
          // P-11 (review 2026-08) — "सूचनाएँ" is notices; this screen is the
          // notifications inbox ("अधिसूचनाएँ"), matching notifications.tsx's
          // hub segment label and the empty state just below.
          errorText={hi ? "अधिसूचनाएँ लोड नहीं हुईं।" : "Could not load notifications."}
          onRetry={notifications.refetch}
          retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
        />
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1 }}
      data={rows}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      // Older notifications past the first page were unreachable before this.
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (notifications.hasNextPage && !notifications.isFetchingNextPage) {
          void notifications.fetchNextPage();
        }
      }}
      ListHeaderComponent={
        unreadCount > 0 ? (
          <Row style={{ justifyContent: "flex-end", marginBottom: 8 }}>
            {/* P-4 (review 2026-08) — POST /v1/notifications/read-all was
                implemented and tested server-side with zero clients. */}
            <Button
              variant="ghost"
              compact
              label={hi ? "सभी पढ़ा हुआ चिह्नित करें" : "Mark all read"}
              onPress={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            />
          </Row>
        ) : null
      }
      ListFooterComponent={
        notifications.isFetchNextPageError ? (
          <View style={{ paddingVertical: 12, alignItems: "center", gap: 6 }}>
            <Body muted style={{ fontSize: 12 }}>
              {hi ? "और लोड नहीं हो सका।" : "Could not load more."}
            </Body>
            <Button
              variant="outline"
              compact
              label={hi ? "पुनः प्रयास करें" : "Try again"}
              onPress={() => void notifications.fetchNextPage()}
            />
          </View>
        ) : null
      }
      ListEmptyComponent={
        <StateView
          status="empty"
          emptyText={hi ? "अभी कोई अधिसूचना नहीं है।" : "No notifications yet."}
        />
      }
      contentContainerStyle={{
        paddingHorizontal: 18,
        paddingTop: 8,
        paddingBottom: 40,
        gap: 14,
      }}
      refreshControl={
        <RefreshControl
          refreshing={!!notifications.isRefetching}
          onRefresh={onRefresh}
          tintColor={c.primary}
          colors={[c.primary]}
        />
      }
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      initialNumToRender={10}
      maxToRenderPerBatch={8}
      windowSize={7}
      removeClippedSubviews={Platform.OS !== "web"}
    />
  );
}
