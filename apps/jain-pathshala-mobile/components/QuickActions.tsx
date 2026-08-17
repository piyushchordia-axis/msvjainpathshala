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
import { ACTIVITY_ACCENT_TOKEN, type ActivityAccentKey } from "@/constants/activity-accents";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";
import { useAuth } from "@/contexts/AuthContext";
import { ROLE_PRECEDENCE } from "@/lib/auth";
import { useAdminCentres, useAttendanceAlerts, useOverview } from "@/lib/queries";
import { Card, Body, Title } from "@/components/ui";

export type QuickAction = {
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
  en: string;
  hi: string;
  accent: ActivityAccentKey;
  /** Optional count badge (e.g. attendance alerts). */
  badge?: number;
};

const PARENT_ACTIONS: QuickAction[] = [
  { href: "/my-attendance", icon: "checkmark-done-outline", en: "Attendance", hi: "उपस्थिति", accent: "attendance" },
  { href: "/niyam-submit", icon: "sparkles-outline", en: "Submit Niyam", hi: "नियम भेजें", accent: "niyam" },
  { href: "/courses", icon: "library-outline", en: "Courses", hi: "पाठ्यक्रम", accent: "courses" },
  { href: "/certificates", icon: "ribbon-outline", en: "Certificates", hi: "प्रमाणपत्र", accent: "certificates" },
  { href: "/homework", icon: "book-outline", en: "Homework", hi: "गृहकार्य", accent: "homework" },
  { href: "/quizzes", icon: "help-circle-outline", en: "Quizzes", hi: "प्रश्नोत्तरी", accent: "quizzes" },
  { href: "/exams", icon: "clipboard-outline", en: "Exams", hi: "परीक्षाएँ", accent: "exams" },
  { href: "/competitions", icon: "trophy-outline", en: "Competitions", hi: "प्रतियोगिताएँ", accent: "competitions" },
  // MSV apply/status had no entry point at all — the endpoints existed but a
  // parent could not reach them, and a pending or rejected application was
  // invisible (only an approved badge rendered, on the home screen).
  { href: "/msv", icon: "school-outline", en: "MSV", hi: "MSV", accent: "courses" },
];

/** Guruji shortcuts — mirrors web admin items that exist on mobile. */
export const SHIKSHAK_ACTIONS: QuickAction[] = [
  { href: "/shikshak/students", icon: "people-outline", en: "Students", hi: "विद्यार्थी", accent: "students" },
  { href: "/shikshak/batches", icon: "grid-outline", en: "Batches", hi: "बैच", accent: "batches" },
  { href: "/shikshak/courses", icon: "library-outline", en: "Courses", hi: "पाठ्यक्रम", accent: "courses" },
  { href: "/shikshak/homework", icon: "book-outline", en: "Homework", hi: "गृहकार्य", accent: "homework" },
  {
    href: "/shikshak/punya",
    icon: "trophy-outline",
    en: "Punya standings",
    hi: "पुण्य स्थिति",
    accent: "punya",
  },
  { href: "/shikshak/niyam-review", icon: "clipboard-outline", en: "Niyam review", hi: "नियम समीक्षा", accent: "niyam" },
  { href: "/shikshak/join-approvals", icon: "person-add-outline", en: "Join approvals", hi: "Join स्वीकृति", accent: "join" },
  { href: "/shikshak/niyams", icon: "sparkles-outline", en: "Niyam catalog", hi: "नियम सूची", accent: "niyam" },
  { href: "/gallery", icon: "images-outline", en: "Punya Wall", hi: "पुण्य दीवार", accent: "punya" },
  // Notices is a min:shikshak row in the web nav, and the server lets a Guruji
  // author centre/batch notices — but mobile had no entry point at all, on the
  // surface this persona actually uses.
  { href: "/notices", icon: "megaphone-outline", en: "Notices", hi: "सूचनाएँ", accent: "notices" },
  { href: "/shikshak/profile", icon: "person-circle-outline", en: "Profile", hi: "प्रोफ़ाइल", accent: "profile" },
];

/** Sanchalak shortcuts — management surfaces that sit outside the five-tab bar. */
export const SANCHALAK_ACTIONS: QuickAction[] = [
  { href: "/admin/centres", icon: "business-outline", en: "Centres", hi: "केंद्र", accent: "centres" },
  { href: "/admin/shikshaks", icon: "people-circle-outline", en: "Shikshaks", hi: "शिक्षक", accent: "shikshaks" },
  { href: "/admin/courses", icon: "library-outline", en: "Courses", hi: "पाठ्यक्रम", accent: "courses" },
  { href: "/admin/holidays", icon: "calendar-outline", en: "Holidays", hi: "अवकाश", accent: "holidays" },
  { href: "/admin/notices", icon: "megaphone-outline", en: "Manage notices", hi: "सूचना प्रबंधन", accent: "notices" },
  { href: "/admin/niyam-review", icon: "clipboard-outline", en: "Niyam review", hi: "नियम समीक्षा", accent: "niyam" },
  { href: "/admin/join", icon: "person-add-outline", en: "Join approvals", hi: "Join स्वीकृति", accent: "join" },
  { href: "/admin/attendance", icon: "checkmark-done-outline", en: "Attendance", hi: "उपस्थिति", accent: "attendance" },
  {
    href: "/admin/service-requests",
    icon: "chatbubbles-outline",
    en: "Service requests",
    hi: "सेवा अनुरोध",
    accent: "serviceRequests",
  },
  { href: "/admin/homework", icon: "book-outline", en: "Homework", hi: "गृहकार्य", accent: "homework" },
  { href: "/admin/gallery", icon: "images-outline", en: "Gallery", hi: "गैलरी", accent: "gallery" },
  { href: "/admin/reports", icon: "document-text-outline", en: "Reports", hi: "रिपोर्ट", accent: "reports" },
  { href: "/admin/enrolments", icon: "clipboard-outline", en: "Enrolments", hi: "नामांकन", accent: "enrolments" },
  { href: "/admin/students", icon: "people-outline", en: "Students", hi: "विद्यार्थी", accent: "students" },
  { href: "/gallery", icon: "ribbon-outline", en: "Punya Wall", hi: "पुण्य दीवार", accent: "punya" },
  { href: "/library", icon: "library-outline", en: "Library", hi: "पुस्तकालय", accent: "library" },
  { href: "/shivirs", icon: "bonfire-outline", en: "Shivirs", hi: "शिविर", accent: "shivirs" },
];

/** City+ extras that sit on the same manage grid (web nav items that exist on mobile). */
const CITY_ADMIN_EXTRA_ACTIONS: QuickAction[] = [
  { href: "/team", icon: "people-outline", en: "Team", hi: "टीम", accent: "shikshaks" },
];

/** Guest home + tabs — stay on `/guest/*` so we do not leave the guest navigator. */
export const GUEST_BROWSE_ACTIONS: QuickAction[] = [
  { href: "/guest/centres", icon: "location-outline", en: "Centres", hi: "केंद्र", accent: "centres" },
  { href: "/team", icon: "people-outline", en: "Team", hi: "टीम", accent: "shikshaks" },
  { href: "/guest/shivirs", icon: "bonfire-outline", en: "Shivirs", hi: "शिविर", accent: "shivirs" },
  { href: "/guest/library", icon: "library-outline", en: "Library", hi: "पुस्तकालय", accent: "library" },
  { href: "/guest/notices", icon: "megaphone-outline", en: "Notices", hi: "सूचनाएँ", accent: "notices" },
  // The public course catalogue was reachable on web but had no guest entry
  // point in the app (GST-API-12).
  { href: "/courses", icon: "book-outline", en: "Courses", hi: "पाठ्यक्रम", accent: "courses" },
];

/** Signed-in homes — shared stack routes, not the guest tab navigator. */
export const SIGNED_IN_BROWSE_ACTIONS: QuickAction[] = [
  { href: "/centres", icon: "location-outline", en: "Centres", hi: "केंद्र", accent: "centres" },
  { href: "/team", icon: "people-outline", en: "Team", hi: "टीम", accent: "shikshaks" },
  { href: "/shivirs", icon: "bonfire-outline", en: "Shivirs", hi: "शिविर", accent: "shivirs" },
  { href: "/library", icon: "library-outline", en: "Library", hi: "पुस्तकालय", accent: "library" },
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
            borderRadius: c.activityTileRadius,
            backgroundColor: c[ACTIVITY_ACCENT_TOKEN[action.accent]],
          },
          animStyle,
        ]}
      >
        <View style={{ position: "relative" }}>
          <Ionicons name={action.icon} size={26} color={c.activityInkStrong} />
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
        <Body
          style={{
            fontSize: 13,
            lineHeight: 18,
            marginTop: 6,
            textAlign: "center",
            color: c.activityInkStrong,
          }}
        >
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
  hideTitle = false,
}: {
  actions?: QuickAction[];
  titleEn?: string;
  titleHi?: string;
  hideTitle?: boolean;
}) {
  const { hi } = useLocale();
  return (
    <Card>
      {hideTitle ? null : (
        <Title style={{ fontSize: 16, marginBottom: 12 }}>{hi ? titleHi : titleEn}</Title>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {actions.map((a) => (
          <ActionTile key={a.href} action={a} />
        ))}
      </View>
    </Card>
  );
}

export function GuestQuickActions() {
  return <QuickActions actions={GUEST_BROWSE_ACTIONS} hideTitle />;
}

export function BrowseQuickActions() {
  return (
    <QuickActions
      actions={SIGNED_IN_BROWSE_ACTIONS}
      titleEn="Browse"
      titleHi="देखें"
    />
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

const NO_EXTRA: QuickAction[] = [];

export function SanchalakQuickActions() {
  return <AdminManageQuickActions extra={NO_EXTRA} />;
}

/** City / state / super — sanchalak manage grid plus city-level destinations. */
export function AdminHomeQuickActions() {
  const { user } = useAuth();
  const cityPlus =
    !!user && (ROLE_PRECEDENCE[user.role] ?? 0) >= ROLE_PRECEDENCE.city_admin;
  return (
    <AdminManageQuickActions extra={cityPlus ? CITY_ADMIN_EXTRA_ACTIONS : []} />
  );
}

function AdminManageQuickActions({ extra }: { extra: QuickAction[] }) {
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
      [...SANCHALAK_ACTIONS, ...extra].map((a) => {
        if (a.href === "/admin/attendance") return { ...a, badge: alertCount };
        if (a.href === "/admin/service-requests") return { ...a, badge: openSr };
        return a;
      }),
    [alertCount, extra, openSr],
  );

  return (
    <QuickActions
      actions={actions}
      titleEn="Manage"
      titleHi="प्रबंधन"
    />
  );
}
