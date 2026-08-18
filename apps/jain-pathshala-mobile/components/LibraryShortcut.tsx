import { Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { Body } from "@/components/ui";

/**
 * A labelled shortcut to Downloads / Bookmarks.
 *
 * These were 40px icon-only circles in the library header. Nothing named them,
 * they sat in the chrome where nobody looks for content, and a download glyph
 * and a bookmark glyph at 22px are not self-evident to a parent who uses three
 * apps. The label costs a line and removes the guess; 44px is the platform's
 * own touch-target floor, which the circles sat under.
 *
 * Its own module rather than living beside LibraryView, because the section
 * screen needs it too — a reader three levels in used to have to back all the
 * way out to reach what they had saved.
 */
export function LibraryShortcut({
  icon,
  label,
  href,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  href: string;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => router.push(href as Href)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        borderRadius: 22,
        backgroundColor: c.muted,
      }}
    >
      <Ionicons name={icon} size={20} color={c.secondary} />
      <Body style={{ fontSize: 13, lineHeight: 22, color: c.secondary }}>{label}</Body>
    </Pressable>
  );
}
