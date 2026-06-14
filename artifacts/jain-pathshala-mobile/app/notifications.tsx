import { Pressable, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useMarkNotificationRead, useNotifications } from "@/lib/queries";
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

  const onPressRow = (id: string, isUnread: boolean) => {
    if (!isUnread || markRead.isPending) return;
    markRead.mutate({ id });
  };

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
      <Screen
        refreshing={notifications.isRefetching}
        onRefresh={() => notifications.refetch()}
      >
        {notifications.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : notifications.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "सूचनाएँ लोड नहीं हुईं।" : "Could not load notifications."}
            onRetry={notifications.refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : rows.length === 0 ? (
          <StateView
            status="empty"
            emptyText={hi ? "अभी कोई सूचना नहीं है।" : "No notifications yet."}
          />
        ) : (
          rows.map((row) => {
            const isUnread = !row.read_at;
            const title = hi ? row.title_hi : row.title_en;
            const body = hi ? row.body_hi : row.body_en;
            return (
              <Pressable
                key={row.id}
                onPress={() => onPressRow(row.id, isUnread)}
                disabled={!isUnread}
              >
                <Card
                  style={
                    isUnread
                      ? { borderColor: c.primary, backgroundColor: c.accent }
                      : undefined
                  }
                >
                  <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Title style={{ fontSize: 16 }}>{title}</Title>
                      <Body muted style={{ fontSize: 11, marginTop: 2 }}>
                        {formatDate(row.created_at)}
                      </Body>
                    </View>
                    {isUnread ? (
                      <Pill label={hi ? "नया" : "New"} tone="primary" />
                    ) : null}
                  </Row>
                  {body ? (
                    <Body muted={!isUnread} style={{ marginTop: 8 }}>
                      {body}
                    </Body>
                  ) : null}
                </Card>
              </Pressable>
            );
          })
        )}
      </Screen>
    </View>
  );
}
