import { View, Platform, Pressable, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";
import { useAdminCentres, useAttendanceAlerts, useOverview } from "@/lib/queries";
import { Card, Body, Title } from "@/components/ui";

export type QuickAction = {
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
  en: string;
  hi: string;
  /** Optional count badge (e.g. attendance alerts). */
  badge?: number;
};

const PARENT_ACTIONS: QuickAction[] = [
  { href: "/notifications", icon: "notifications-outline", en: "Notifications", hi: "सूचनाएँ" },
  { href: "/my-attendance", icon: "checkmark-done-outline", en: "Attendance", hi: "उपस्थिति" },
  { href: "/niyam-submit", icon: "sparkles-outline", en: "Submit Niyam", hi: "नियम भेजें" },
  { href: "/courses", icon: "library-outline", en: "Courses", hi: "पाठ्यक्रम" },
  { href: "/certificates", icon: "ribbon-outline", en: "Certificates", hi: "प्रमाणपत्र" },
  { href: "/homework", icon: "book-outline", en: "Homework", hi: "गृहकार्य" },
  { href: "/quizzes", icon: "help-circle-outline", en: "Quizzes", hi: "प्रश्नोत्तरी" },
  { href: "/exams", icon: "clipboard-outline", en: "Exams", hi: "परीक्षाएँ" },
  { href: "/competitions", icon: "trophy-outline", en: "Competitions", hi: "प्रतियोगिताएँ" },
];

/** Guruji shortcuts — mirrors web admin items that exist on mobile. */
export const SHIKSHAK_ACTIONS: QuickAction[] = [
  { href: "/shikshak/students", icon: "people-outline", en: "Students", hi: "विद्यार्थी" },
  { href: "/shikshak/batches", icon: "grid-outline", en: "Batches", hi: "बैच" },
  { href: "/shikshak/courses", icon: "library-outline", en: "Courses", hi: "पाठ्यक्रम" },
  { href: "/shikshak/homework", icon: "book-outline", en: "Homework", hi: "गृहकार्य" },
  {
    href: "/shikshak/punya",
    icon: "trophy-outline",
    en: "Punya standings",
    hi: "पुण्य स्थिति",
  },
  { href: "/shikshak/niyam-review", icon: "clipboard-outline", en: "Niyam review", hi: "नियम समीक्षा" },
  { href: "/shikshak/niyams", icon: "sparkles-outline", en: "Niyam catalog", hi: "नियम सूची" },
  { href: "/notifications", icon: "notifications-outline", en: "Notifications", hi: "सूचनाएँ" },
  { href: "/gallery", icon: "images-outline", en: "Punya Wall", hi: "पुण्य दीवार" },
  { href: "/shikshak/profile", icon: "person-circle-outline", en: "Profile", hi: "प्रोफ़ाइल" },
];

/** Sanchalak shortcuts — management surfaces that sit outside the five-tab bar. */
export const SANCHALAK_ACTIONS: QuickAction[] = [
  { href: "/admin/centres", icon: "business-outline", en: "Centres", hi: "केंद्र" },
  { href: "/admin/shikshaks", icon: "people-circle-outline", en: "Shikshaks", hi: "शिक्षक" },
  { href: "/admin/courses", icon: "library-outline", en: "Courses", hi: "पाठ्यक्रम" },
  { href: "/admin/holidays", icon: "calendar-outline", en: "Holidays", hi: "अवकाश" },
  { href: "/admin/notices", icon: "megaphone-outline", en: "Notices", hi: "सूचनाएँ" },
  { href: "/admin/niyam-review", icon: "clipboard-outline", en: "Niyam review", hi: "नियम समीक्षा" },
  { href: "/admin/attendance", icon: "checkmark-done-outline", en: "Attendance", hi: "उपस्थिति" },
  {
    href: "/admin/service-requests",
    icon: "chatbubbles-outline",
    en: "Service requests",
    hi: "सेवा अनुरोध",
  },
  { href: "/admin/homework", icon: "book-outline", en: "Homework", hi: "गृहकार्य" },
  { href: "/admin/gallery", icon: "images-outline", en: "Gallery", hi: "गैलरी" },
  { href: "/admin/reports", icon: "document-text-outline", en: "Reports", hi: "रिपोर्ट" },
  { href: "/admin/enrolments", icon: "clipboard-outline", en: "Enrolments", hi: "नामांकन" },
  { href: "/admin/students", icon: "people-outline", en: "Students", hi: "विद्यार्थी" },
  { href: "/gallery", icon: "ribbon-outline", en: "Punya Wall", hi: "पुण्य दीवार" },
  { href: "/notifications", icon: "notifications-outline", en: "Notifications", hi: "अधिसूचनाएँ" },
];

function ActionTile({ action }: { action: QuickAction }) {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const badge = action.badge && action.badge > 0 ? action.badge : 0;

  return (
    <Pressable
      onPressIn={() => {
        scale.value = withTiming(0.94, { duration: 90 });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: 120 });
      }}
      onPress={() => {
        if (Platform.OS !== "web") {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        router.push(action.href as never);
      }}
      style={{ width: "30%" }}
    >
      <Animated.View
        style={[
          {
            alignItems: "center",
            paddingVertical: 14,
            borderRadius: c.radius ?? 12,
            backgroundColor: c.muted,
          },
          animStyle,
        ]}
      >
        <View style={{ position: "relative" }}>
          <Ionicons name={action.icon} size={26} color={c.primary} />
          {badge > 0 ? (
            <View
              style={{
                position: "absolute",
                top: -6,
                right: -10,
                minWidth: 18,
                height: 18,
                borderRadius: 9,
                paddingHorizontal: 4,
                backgroundColor: c.primary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  fontSize: 10,
                  lineHeight: 12,
                  color: c.primaryForeground,
                  fontFamily: bodyFamily(false, "semibold"),
                }}
              >
                {badge > 99 ? "99+" : String(badge)}
              </Text>
            </View>
          ) : null}
        </View>
        <Body style={{ fontSize: 11, marginTop: 6, textAlign: "center" }}>
          {hi ? action.hi : action.en}
        </Body>
      </Animated.View>
    </Pressable>
  );
}

/** A grid of quick links — parent/student Activities by default. */
export function QuickActions({
  actions = PARENT_ACTIONS,
  titleEn = "Activities",
  titleHi = "गतिविधियाँ",
}: {
  actions?: QuickAction[];
  titleEn?: string;
  titleHi?: string;
}) {
  const { hi } = useLocale();
  return (
    <Card>
      <Title style={{ fontSize: 16, marginBottom: 12 }}>{hi ? titleHi : titleEn}</Title>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {actions.map((a) => (
          <ActionTile key={a.href} action={a} />
        ))}
      </View>
    </Card>
  );
}

export function ShikshakQuickActions() {
  return (
    <QuickActions
      actions={SHIKSHAK_ACTIONS}
      titleEn="Guruji menu"
      titleHi="गुरुजी मेनू"
    />
  );
}

export function SanchalakQuickActions() {
  const centresQ = useAdminCentres();
  const [centreId, setCentreId] = useState<string | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem("jp.sanchalak.selectedCentreId").then((stored) => {
      if (stored) setCentreId(stored);
    });
  }, []);

  useEffect(() => {
    const items = centresQ.data?.items ?? [];
    if (items.length === 0) return;
    const valid = centreId && items.some((c) => c.id === centreId);
    if (!valid) setCentreId(items[0]!.id);
  }, [centresQ.data?.items, centreId]);

  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    [],
  );
  const alerts = useAttendanceAlerts(centreId, today, !!centreId);
  const alertCount =
    typeof alerts.data?.meta?.alert_count === "number"
      ? (alerts.data.meta.alert_count as number)
      : 0;
  const overview = useOverview();
  const openSr =
    typeof overview.data?.open_service_requests === "number"
      ? overview.data.open_service_requests
      : 0;

  const actions = useMemo(
    () =>
      SANCHALAK_ACTIONS.map((a) => {
        if (a.href === "/admin/attendance") return { ...a, badge: alertCount };
        if (a.href === "/admin/service-requests") return { ...a, badge: openSr };
        return a;
      }),
    [alertCount, openSr],
  );

  return (
    <QuickActions
      actions={actions}
      titleEn="Manage"
      titleHi="प्रबंधन"
    />
  );
}
