import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { bodyFamily } from "@/constants/typography";
import { useActivityPageBg } from "@/contexts/ActivityThemeContext";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { resolveUploadUrl } from "@/lib/api";
import { useNotifications } from "@/lib/queries";
import { Body, Title, useWebTopInset } from "@/components/ui";

/** EN / हिं switch — use on Profile (and auth/guest settings), not on every screen. */
export function LanguageToggle() {
  const { locale, toggleLocale } = useLocale();
  const c = useColors();
  return (
    <Pressable
      onPress={toggleLocale}
      style={{
        flexDirection: "row",
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 999,
        overflow: "hidden",
        backgroundColor: c.card,
      }}
    >
      <View style={{ paddingHorizontal: 11, paddingVertical: 5, backgroundColor: locale === "en" ? c.primary : "transparent" }}>
        <Text style={{ fontFamily: bodyFamily(false, "semibold"), fontSize: 12, color: locale === "en" ? c.primaryForeground : c.mutedForeground }}>
          EN
        </Text>
      </View>
      <View style={{ paddingHorizontal: 11, paddingVertical: 5, backgroundColor: locale === "hi" ? c.primary : "transparent" }}>
        <Text style={{ fontFamily: bodyFamily(true, "semibold"), fontSize: 12, color: locale === "hi" ? c.primaryForeground : c.mutedForeground }}>
          हिं
        </Text>
      </View>
    </Pressable>
  );
}

/** Initials from a display name — up to two letters (e.g. "Reyansh Jain" → "RJ"). */
export function initialsFromName(name: string | null | undefined): string {
  if (!name?.trim()) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

/**
 * Circular photo / initials control — opens the student (or parent) profile tab.
 * Pass `href` when the profile route differs by persona.
 */
export function ProfileAvatarButton({
  name,
  photoUrl,
  href = "/student/profile",
  size = 40,
}: {
  name?: string | null;
  photoUrl?: string | null;
  href?: string;
  size?: number;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();
  const uri = resolveUploadUrl(photoUrl);
  const initials = initialsFromName(name);

  return (
    <Pressable
      onPress={() => router.push(href as never)}
      accessibilityRole="button"
      accessibilityLabel={hi ? "प्रोफ़ाइल खोलें" : "Open profile"}
      hitSlop={8}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: "hidden",
        backgroundColor: c.primary,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 2,
        borderColor: c.card,
      }}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text
          style={{
            fontFamily: bodyFamily(false, "semibold"),
            fontSize: size * 0.36,
            color: c.primaryForeground,
          }}
        >
          {initials}
        </Text>
      )}
    </Pressable>
  );
}

/** Bell → Notifications | Notices hub. Shows unread count from the inbox API. */
export function HeaderBellButton({
  href = "/notifications" as Href,
  size = 40,
}: {
  href?: Href;
  size?: number;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();
  const notifications = useNotifications();
  const unread = notifications.data?.unread_count ?? 0;
  const badge = unread > 99 ? "99+" : unread > 0 ? String(unread) : null;

  return (
    <Pressable
      onPress={() => router.push(href)}
      accessibilityRole="button"
      accessibilityLabel={
        unread > 0
          ? hi
            ? `सूचनाएँ, ${unread} अपठित`
            : `Notifications, ${unread} unread`
          : hi
            ? "सूचनाएँ और घोषणाएँ"
            : "Notifications and notices"
      }
      hitSlop={8}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: c.muted,
      }}
    >
      <Ionicons name="notifications-outline" size={22} color={c.secondary} />
      {badge ? (
        <View
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            minWidth: 16,
            height: 16,
            paddingHorizontal: 4,
            borderRadius: 999,
            backgroundColor: c.primary,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1.5,
            borderColor: c.card,
          }}
        >
          <Text
            style={{
              fontFamily: bodyFamily(false, "semibold"),
              fontSize: 9,
              lineHeight: 11,
              color: c.primaryForeground,
            }}
          >
            {badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Home trailing cluster: bell + profile avatar. */
export function HeaderHomeActions({
  name,
  photoUrl,
  profileHref,
}: {
  name?: string | null;
  photoUrl?: string | null;
  profileHref: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <HeaderBellButton />
      <ProfileAvatarButton name={name} photoUrl={photoUrl} href={profileHref} />
    </View>
  );
}

/** Custom in-screen header for tab screens (tabs render with headerShown: false). */
export function AppHeader({
  title,
  subtitle,
  right,
  compact,
}: {
  title: string;
  subtitle?: string;
  /** Optional trailing control (e.g. profile avatar). */
  right?: ReactNode;
  /** Tighter vertical padding (e.g. ID card). */
  compact?: boolean;
}) {
  const pageBg = useActivityPageBg();
  const top = useWebTopInset();
  return (
    <View
      style={{
        paddingTop: top + (compact ? 4 : 10),
        paddingHorizontal: 18,
        paddingBottom: compact ? 8 : 12,
        backgroundColor: pageBg,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Title>{title}</Title>
          {subtitle ? <Body muted style={{ marginTop: 3 }}>{subtitle}</Body> : null}
        </View>
        {right ?? null}
      </View>
    </View>
  );
}
