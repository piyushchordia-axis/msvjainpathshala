import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useNotices } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

export default function GuestNoticesScreen() {
  const c = useColors();
  const { hi } = useLocale();

  const { data, isLoading, isError, refetch, isRefetching } = useNotices();
  const items = data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "सार्वजनिक सूचनाएँ" : "Public notices"}
        subtitle={hi ? "नेटवर्क की ताज़ा घोषणाएँ" : "Latest announcements from the network"}
      />
      <Screen refreshing={isRefetching} onRefresh={refetch} contentStyle={{ paddingBottom: 110 }}>
        {isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "सूचनाएँ लोड नहीं हो सकीं।" : "Could not load notices."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView status="empty" emptyText={hi ? "अभी कोई सूचना नहीं है।" : "No notices right now."} />
        ) : (
          items.map((notice) => {
            const title = hi && notice.title_hi ? notice.title_hi : notice.title_en;
            const content = hi && notice.content_hi ? notice.content_hi : notice.content_en;
            return (
              <Card key={notice.id}>
                <Row style={{ gap: 8, marginBottom: notice.pinned || notice.is_critical ? 8 : 0 }}>
                  {notice.is_critical ? <Pill tone="error" label={hi ? "महत्वपूर्ण" : "Important"} /> : null}
                  {notice.pinned ? <Pill tone="warning" label={hi ? "पिन किया" : "Pinned"} /> : null}
                </Row>
                <Title style={{ fontSize: 18 }}>{title}</Title>
                {content ? <Body muted style={{ marginTop: 6, lineHeight: 22 }}>{content}</Body> : null}
                <Body muted style={{ marginTop: 10, fontSize: 12 }}>{formatDate(notice.created_at)}</Body>
              </Card>
            );
          })
        )}
      </Screen>
    </View>
  );
}
