import { useCallback } from "react";
import { FlatList, Platform, Pressable, RefreshControl, View, type ListRenderItem } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useMarkNotificationRead, useNotifications, type NotificationRow } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

export default function Notifications() {
  const c = useColors();
  const { hi } = useLocale();

  const notifications = useNotifications();
  const markRead = useMarkNotificationRead();

  const rows = notifications.data?.items ?? [];
  const unreadCount = notifications.data?.unread_count ?? 0;

  const onPressRow = useCallback(
    (id: string, isUnread: boolean) => {
      if (!isUnread || markRead.isPending) return;
      markRead.mutate({ id });
    },
    [markRead],
  );

  const onRefresh = useCallback(() => {
    notifications.refetch();
  }, [notifications]);

  const renderItem: ListRenderItem<NotificationRow> = useCallback(
    ({ item }) => {
      const isUnread = !item.read_at;
      const title = hi ? item.title_hi ?? item.title_en : item.title_en;
      const body = hi ? item.body_hi ?? item.body_en : item.body_en;
      return (
        <Pressable onPress={() => onPressRow(item.id, isUnread)} disabled={!isUnread}>
          <Card
            style={
              isUnread ? { borderColor: c.primary, backgroundColor: c.accent } : undefined
            }
          >
            <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Title style={{ fontSize: 16 }}>{title}</Title>
                <Body muted style={{ fontSize: 11, marginTop: 2 }}>
                  {formatDate(item.created_at)}
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

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "सूचनाएँ" : "Notifications"}
        subtitle={
          unreadCount > 0
            ? hi
              ? `${unreadCount} अपठित सूचनाएँ`
              : `${unreadCount} unread`
            : hi
              ? "आपके लिए सभी अपडेट"
              : "All your updates"
        }
      />
      <Screen scroll={false} contentStyle={{ flex: 1, paddingHorizontal: 0 }}>
        {notifications.isLoading ? (
          <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
            <StateView status="loading" emptyText="" />
          </View>
        ) : notifications.isError ? (
          <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
            <StateView
              status="error"
              emptyText=""
              errorText={hi ? "सूचनाएँ लोड नहीं हुईं।" : "Could not load notifications."}
              onRetry={notifications.refetch}
              retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
            />
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            ListEmptyComponent={
              <StateView
                status="empty"
                emptyText={hi ? "अभी कोई सूचना नहीं है।" : "No notifications yet."}
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
        )}
      </Screen>
    </View>
  );
}
