import { useCallback, useRef } from "react";
import { FlatList, RefreshControl, View, type ListRenderItem, type ViewToken } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useNotices } from "@/lib/queries";
import type { NoticeItem as PublicNoticeItem } from "@/lib/types";
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

const FEED_LIMIT = 50;

function useNoticesFeed(enabled: boolean) {
  return useQuery({
    queryKey: ["me", "notices-feed"],
    queryFn: () => apiGet<FeedResponse>(`/v1/notices/feed?limit=${FEED_LIMIT}`),
    enabled,
  });
}

type NoticeItem = FeedNotice | PublicNoticeItem;
const isFeedNotice = (n: NoticeItem): n is FeedNotice => "audience" in n;

function NoticesListBody({
  tabBarInset = false,
}: {
  tabBarInset?: boolean;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const { user, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const isMember = !!user;

  // P-9 (review 2026-08) — while auth is hydrating, `isMember` reads false
  // even for a signed-in member, so the guest feed briefly rendered and then
  // swapped to the member feed a beat later. Fetch neither until auth
  // resolves, and fetch only the one that will actually be shown.
  const publicFeed = useNotices(!authLoading && !isMember);
  const memberFeed = useNoticesFeed(!authLoading && isMember);

  const markRead = useMutation({
    mutationFn: (id: string) => apiPost(`/v1/notices/${id}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me", "notices-feed"] }),
  });

  const active = isMember ? memberFeed : publicFeed;
  const { isError, refetch, isRefetching } = active;
  const isLoading = authLoading || active.isLoading;
  const items: NoticeItem[] = (isMember ? memberFeed.data?.items : publicFeed.data?.items) ?? [];

  // P-1 (review 2026-08) — this used to be a useEffect that marked EVERY
  // unread notice read the instant the list painted (destroying the "new"
  // signal on arrival) and, because each mutation's onSuccess invalidated
  // the very query the effect depended on, could re-fire as a request loop.
  // Marking on actual viewability is both the fix and the better UX: only
  // notices the reader actually scrolled to are marked seen.
  const markedRef = useRef<Set<string>>(new Set());
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<NoticeItem>[] }) => {
      if (!isMember) return;
      for (const { item } of viewableItems) {
        if (!isFeedNotice(item) || item.read_at || markedRef.current.has(item.id)) continue;
        markedRef.current.add(item.id);
        markRead.mutate(item.id);
      }
    },
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  // FlatList so a 50-notice feed virtualises instead of mounting every card
  // in one ScrollView (GST-PRF-02).
  const renderItem = useCallback<ListRenderItem<NoticeItem>>(
    ({ item: notice }) => {
      const title = hi && notice.title_hi ? notice.title_hi : notice.title_en;
      const content = hi && notice.content_hi ? notice.content_hi : notice.content_en;
      const unread = isFeedNotice(notice) && !notice.read_at;
      const internal = isFeedNotice(notice) && !notice.is_public;
      return (
        <Card>
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
            {formatDate(notice.created_at, hi)}
          </Body>
        </Card>
      );
    },
    [hi],
  );

  return (
    <Screen scroll={false} contentStyle={{ flex: 1, paddingHorizontal: 0, paddingBottom: 0 }}>
      {isLoading ? (
        <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
          <StateView status="loading" emptyText="" />
        </View>
      ) : isError ? (
        <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
          <StateView
            status="error"
            emptyText=""
            // P-11 (review 2026-08) — canonical Hindi term for notices is
            // "सूचनाएँ" (matches the web NoticesPage and admin composer).
            errorText={hi ? "सूचनाएँ लोड नहीं हो सकीं।" : "Could not load notices."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(notice) => notice.id}
          renderItem={renderItem}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          ListEmptyComponent={
            <StateView
              status="empty"
              emptyText={hi ? "अभी कोई सूचना नहीं है।" : "No notices right now."}
            />
          }
          ListFooterComponent={
            // G-3 (review 2026-08) — a silent 51st-notice cutoff read as
            // "that's everything"; a real cursor would be the complete fix,
            // this at least signals more may exist.
            items.length >= FEED_LIMIT ? (
              <Body muted style={{ textAlign: "center", fontSize: 11, paddingVertical: 8 }}>
                {hi ? `नवीनतम ${FEED_LIMIT} सूचनाएँ दिखाई गई हैं।` : `Showing the latest ${FEED_LIMIT} notices.`}
              </Body>
            ) : null
          }
          contentContainerStyle={{
            paddingHorizontal: 18,
            paddingTop: 8,
            paddingBottom: tabBarInset ? 110 : 40,
            gap: 14,
          }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={c.primary}
              colors={[c.primary]}
            />
          }
          showsVerticalScrollIndicator={false}
        />
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
          title={hi ? "सूचनाएँ" : "Notices"}
          subtitle={
            isMember
              ? hi
                ? "आपके लिए प्रासंगिक सूचनाएँ"
                : "Announcements relevant to you"
              : hi
                ? "नेटवर्क की ताज़ा सूचनाएँ"
                : "Latest announcements from the network"
          }
        />
      ) : null}
      <NoticesListBody tabBarInset={tabBarInset} />
    </ActivityThemed>
  );
}
