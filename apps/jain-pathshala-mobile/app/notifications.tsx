import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { bodyFamily } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { routeForRole } from "@/lib/roles";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useNotifications } from "@/lib/queries";
import { AppHeader } from "@/components/AppHeader";
import { NotificationsInbox } from "@/components/NotificationsInbox";
import { NoticesFeedScreen } from "@/components/NoticesFeedScreen";

type HubTab = "notifications" | "notices";

function parseTab(raw: string | string[] | undefined): HubTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "notices" ? "notices" : "notifications";
}

function HubSegment({
  active,
  onChange,
}: {
  active: HubTab;
  onChange: (tab: HubTab) => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const tabs: Array<{ key: HubTab; en: string; hi: string }> = [
    { key: "notifications", en: "Notifications", hi: "अधिसूचनाएँ" },
    { key: "notices", en: "Notices", hi: "घोषणाएँ" },
  ];

  return (
    <View
      style={{
        flexDirection: "row",
        marginHorizontal: 18,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 999,
        overflow: "hidden",
        backgroundColor: c.card,
      }}
    >
      {tabs.map((t) => {
        const selected = active === t.key;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={{
              flex: 1,
              paddingVertical: 10,
              alignItems: "center",
              backgroundColor: selected ? c.primary : "transparent",
            }}
          >
            <Text
              style={{
                fontFamily: bodyFamily(hi, "semibold"),
                fontSize: 13,
                // P-10 (review 2026-08) — the only genuinely broken lineHeight
                // site; a raw Text with no lineHeight sits under CLAUDE.md's
                // 22px Devanagari floor (Body/Title already bake in 22px
                // defaults elsewhere, so this was the one exception).
                lineHeight: 22,
                color: selected ? c.primaryForeground : c.mutedForeground,
              }}
            >
              {hi ? t.hi : t.en}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Signed-in hub: Notifications inbox + Notices feed behind the header bell. */
export default function NotificationsHub() {
  const { hi } = useLocale();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string | string[] }>();
  const [tab, setTab] = useState<HubTab>(() => parseTab(params.tab));
  // P-8 (review 2026-08) — routeForNotificationData falls back to
  // /notifications for most kinds; tapping a push while signed out (or
  // after a session expired) previously rendered a 401 as "Could not load
  // notifications" instead of sending the user to sign in.
  const { user, loading: authLoading } = useAuth();
  const notifications = useNotifications(!authLoading && !!user);
  const unreadCount = notifications.data?.unread_count ?? 0;

  if (authLoading) return null;
  if (!user) return <Redirect href={routeForRole(undefined)} />;

  useEffect(() => {
    setTab(parseTab(params.tab));
  }, [params.tab]);

  const onChangeTab = (next: HubTab) => {
    setTab(next);
    router.setParams({ tab: next });
  };

  const subtitle = useMemo(() => {
    if (tab === "notices") {
      return hi ? "पाठशाला और केंद्र की घोषणाएँ" : "Pathshala and centre announcements";
    }
    if (unreadCount > 0) {
      return hi ? `${unreadCount} अपठित अधिसूचनाएँ` : `${unreadCount} unread`;
    }
    return hi ? "आपके लिए सभी अपडेट" : "All your updates";
  }, [hi, tab, unreadCount]);

  return (
    <ActivityThemed accent={tab === "notices" ? "notices" : "notifications"}>
      <AppHeader
        title={hi ? "सूचना केंद्र" : "Inbox"}
        subtitle={subtitle}
      />
      <HubSegment active={tab} onChange={onChangeTab} />
      <View style={{ flex: 1 }}>
        {tab === "notifications" ? <NotificationsInbox /> : <NoticesFeedScreen embedded />}
      </View>
    </ActivityThemed>
  );
}
