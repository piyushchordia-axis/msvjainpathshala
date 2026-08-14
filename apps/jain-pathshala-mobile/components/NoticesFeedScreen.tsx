import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useNotices } from "@/lib/queries";
import { apiGet, apiPost } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

/**
 * Notices feed. A guest sees /v1/notices/public. A signed-in member sees
 * /v1/notices/feed (national + their state/city/centre/batch + MSV).
 */

type Audience = "batch" | "centre" | "city" | "state" | "national" | "msv";

interface FeedNotice {
  id: string;
  title_en: string | null;
  title_hi: string | null;
  content_en: string | null;
  content_hi: string | null;
  audience: Audience;
  is_public: boolean;
  pinned: boolean;
  is_critical: boolean;
  published_at: string | null;
  created_at: string;
  read_at: string | null;
}

interface FeedResponse {
  items: FeedNotice[];
  unread_count: number;
}

function useNoticesFeed(enabled: boolean) {
  return useQuery({
    queryKey: ["me", "notices-feed"],
    queryFn: () => apiGet<FeedResponse>("/v1/notices/feed?limit=50"),
    enabled,
  });
}

function NoticesListBody({
  tabBarInset = false,
}: {
  tabBarInset?: boolean;
}) {
  const { hi } = useLocale();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isMember = !!user;

  const publicFeed = useNotices();
  const memberFeed = useNoticesFeed(isMember);

  const markRead = useMutation({
    mutationFn: (id: string) => apiPost(`/v1/notices/${id}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me", "notices-feed"] }),
  });

  const active = isMember ? memberFeed : publicFeed;
  const { isLoading, isError, refetch, isRefetching } = active;
  const items = (isMember ? memberFeed.data?.items : publicFeed.data?.items) ?? [];

  useEffect(() => {
    if (!isMember || !memberFeed.data?.items) return;
    const unread = memberFeed.data.items.filter((n) => !n.read_at);
    if (unread.length === 0) return;
    for (const n of unread) markRead.mutate(n.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMember, memberFeed.data]);

  return (
    <Screen
      refreshing={isRefetching}
      onRefresh={refetch}
      contentStyle={{ paddingBottom: tabBarInset ? 110 : undefined }}
    >
      {isLoading ? (
        <StateView status="loading" emptyText="" />
      ) : isError ? (
        <StateView
          status="error"
          emptyText=""
          errorText={hi ? "घोषणाएँ लोड नहीं हो सकीं।" : "Could not load notices."}
          onRetry={refetch}
          retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
        />
      ) : items.length === 0 ? (
        <StateView
          status="empty"
          emptyText={hi ? "अभी कोई घोषणा नहीं है।" : "No notices right now."}
        />
      ) : (
        items.map((notice) => {
          const title = hi && notice.title_hi ? notice.title_hi : notice.title_en;
          const content = hi && notice.content_hi ? notice.content_hi : notice.content_en;
          const isFeed = (n: typeof notice): n is FeedNotice => "audience" in n;
          const unread = isFeed(notice) && !notice.read_at;
          const internal = isFeed(notice) && !notice.is_public;
          return (
            <Card key={notice.id}>
              <Row style={{ gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                {unread ? <Pill tone="info" label={hi ? "नया" : "New"} /> : null}
                {notice.is_critical ? (
                  <Pill tone="error" label={hi ? "महत्वपूर्ण" : "Important"} />
                ) : null}
                {notice.pinned ? <Pill tone="warning" label={hi ? "पिन किया" : "Pinned"} /> : null}
                {internal ? <Pill tone="neutral" label={hi ? "आंतरिक" : "Internal"} /> : null}
              </Row>
              <Title style={{ fontSize: 18 }}>{title}</Title>
              {content ? (
                <Body muted style={{ marginTop: 6, lineHeight: 22 }}>
                  {content}
                </Body>
              ) : null}
              <Body muted style={{ marginTop: 10, fontSize: 12 }}>
                {formatDate(notice.created_at)}
              </Body>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

export function NoticesFeedScreen({
  tabBarInset = false,
  embedded = false,
}: {
  tabBarInset?: boolean;
  /** Inside the notifications hub — no page chrome / pastel wrap. */
  embedded?: boolean;
}) {
  const { hi } = useLocale();
  const { user } = useAuth();
  const isMember = !!user;

  if (embedded) {
    return <NoticesListBody />;
  }

  return (
    <ActivityThemed accent="notices">
      {tabBarInset ? (
        <AppHeader
          title={hi ? "घोषणाएँ" : "Notices"}
          subtitle={
            isMember
              ? hi
                ? "आपके लिए प्रासंगिक घोषणाएँ"
                : "Announcements relevant to you"
              : hi
                ? "नेटवर्क की ताज़ा घोषणाएँ"
                : "Latest announcements from the network"
          }
        />
      ) : null}
      <NoticesListBody tabBarInset={tabBarInset} />
    </ActivityThemed>
  );
}
