import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Body } from "@/components/ui";
import { badgeLadder, badgeLabel } from "@/lib/niyam-badges";

type Earned = { badge_key: string };

type Props = {
  niyamType: string;
  earnedBadges?: Earned[] | null;
  hi: boolean;
};

/**
 * Full streak ladder — every milestone shown.
 * Unlocked = clear green; next target = saffron; later locked = solid cream chip
 * with ink text (no opacity fade — that made streaks unreadable on the niyam wash).
 */
export function NiyamBadgeRow({ niyamType, earnedBadges, hi }: Props) {
  const c = useColors();
  const ladder = badgeLadder(niyamType);
  const earned = new Set((earnedBadges ?? []).map((b) => b.badge_key));
  const nextKey = ladder.find((m) => !earned.has(m.key))?.key ?? null;

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {ladder.map((m) => {
        const unlocked = earned.has(m.key);
        const isNext = !unlocked && m.key === nextKey;

        const backgroundColor = unlocked
          ? c.successSoft
          : isNext
            ? c.accent
            : c.card;
        const borderColor = unlocked
          ? c.successText
          : isNext
            ? c.primary
            : c.secondary;
        const textColor = unlocked
          ? c.successText
          : isNext
            ? c.primary
            : c.foreground;

        return (
          <View
            key={m.key}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 999,
              backgroundColor,
              borderWidth: isNext || unlocked ? 1.5 : 1,
              borderColor,
            }}
          >
            <Body
              style={{
                fontSize: 13,
                lineHeight: 18,
                fontWeight: "700",
                color: textColor,
              }}
            >
              {unlocked ? "✓ " : isNext ? "→ " : "○ "}
              {badgeLabel(m.key, hi)}
            </Body>
          </View>
        );
      })}
    </View>
  );
}
