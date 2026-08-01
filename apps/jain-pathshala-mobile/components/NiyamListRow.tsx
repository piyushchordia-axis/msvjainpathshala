import { Pressable, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Body, Row } from "@/components/ui";

/** Compact tinted chip palette by niyam cadence (daily / weekly / monthly). */
export function niyamAccent(type: string, c: ReturnType<typeof useColors>) {
  const t = type.toLowerCase();
  if (t === "weekly") {
    return { bg: "#F3E8E8", stripe: c.maroon, badge: c.maroon, badgeFg: "#FFFFFF" };
  }
  if (t === "monthly") {
    return { bg: "#FFF4DB", stripe: c.gold, badge: c.gold, badgeFg: "#1A0700" };
  }
  return { bg: "#FDE9DC", stripe: c.saffron, badge: c.saffron, badgeFg: "#FFFFFF" };
}

type Props = {
  title: string;
  meta?: string | null;
  /** Points shown in the type-colored badge (omit to hide). */
  points?: number | null;
  niyamType: string;
  /** Optional status / tag chip on the right of the title row. */
  statusLabel?: string | null;
  statusTone?: "success" | "warning" | "error" | "neutral" | "primary";
  emphasizedMeta?: boolean;
  onPress?: () => void;
  showChevron?: boolean;
};

function statusColors(
  tone: NonNullable<Props["statusTone"]>,
  c: ReturnType<typeof useColors>,
) {
  if (tone === "success") return { bg: "#E4F5E8", fg: "#1F6B35" };
  if (tone === "warning") return { bg: "#FFF1D6", fg: "#8A5A00" };
  if (tone === "error") return { bg: "#FDE8E8", fg: "#9B1C1C" };
  if (tone === "primary") return { bg: c.saffron, fg: "#FFFFFF" };
  return { bg: "#EEE7DF", fg: c.mutedForeground };
}

/** Compact colorful niyam row — shared by submit picker and view screens. */
export function NiyamListRow({
  title,
  meta,
  points,
  niyamType,
  statusLabel,
  statusTone = "neutral",
  emphasizedMeta,
  onPress,
  showChevron,
}: Props) {
  const c = useColors();
  const accent = niyamAccent(niyamType, c);
  const statusPal = statusLabel ? statusColors(statusTone, c) : null;
  const chevron = showChevron ?? !!onPress;

  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: accent.bg,
        borderRadius: c.radius,
        overflow: "hidden",
        minHeight: 56,
      }}
    >
      <View style={{ width: 5, alignSelf: "stretch", backgroundColor: accent.stripe }} />
      <View style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 12 }}>
        <Row style={{ alignItems: "center", gap: 8 }}>
          <Body
            style={{
              flex: 1,
              fontSize: 15,
              fontWeight: "700",
              color: c.foreground,
            }}
            numberOfLines={2}
          >
            {title}
          </Body>
          {statusPal && statusLabel ? (
            <View
              style={{
                backgroundColor: statusPal.bg,
                borderRadius: 999,
                paddingHorizontal: 8,
                paddingVertical: 3,
              }}
            >
              <Body style={{ fontSize: 11, fontWeight: "700", color: statusPal.fg }}>
                {statusLabel}
              </Body>
            </View>
          ) : null}
          {points != null ? (
            <View
              style={{
                backgroundColor: accent.badge,
                borderRadius: 999,
                paddingHorizontal: 8,
                paddingVertical: 3,
              }}
            >
              <Body style={{ fontSize: 12, fontWeight: "700", color: accent.badgeFg }}>
                +{points}
              </Body>
            </View>
          ) : null}
        </Row>
        {meta ? (
          <Body
            style={{
              marginTop: 3,
              fontSize: 11,
              color: c.mutedForeground,
              fontWeight: emphasizedMeta ? "600" : "400",
            }}
            numberOfLines={1}
          >
            {meta}
          </Body>
        ) : null}
      </View>
      {chevron ? (
        <Body style={{ marginRight: 12, fontSize: 18, color: accent.stripe }}>›</Body>
      ) : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.92 : 1,
        borderRadius: c.radius,
        borderWidth: 1,
        borderColor: pressed ? accent.stripe : "transparent",
      })}
    >
      {content}
    </Pressable>
  );
}
