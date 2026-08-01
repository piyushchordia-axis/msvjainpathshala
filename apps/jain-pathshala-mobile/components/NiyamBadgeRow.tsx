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

/** Compact streak badge row — unlocked when earned, locked otherwise. */
export function NiyamBadgeRow({ niyamType, earnedBadges, hi }: Props) {
  const c = useColors();
  const ladder = badgeLadder(niyamType);
  const earned = new Set((earnedBadges ?? []).map((b) => b.badge_key));

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {ladder.map((m) => {
        const unlocked = earned.has(m.key);
        return (
          <View
            key={m.key}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 999,
              backgroundColor: unlocked ? "#E4F5E8" : "#EEE7DF",
              opacity: unlocked ? 1 : 0.65,
              borderWidth: 1,
              borderColor: unlocked ? "#1F6B35" : c.border,
            }}
          >
            <Body
              style={{
                fontSize: 11,
                fontWeight: "700",
                color: unlocked ? "#1F6B35" : c.mutedForeground,
              }}
            >
              {unlocked ? "✓ " : "○ "}
              {badgeLabel(m.key, hi)}
            </Body>
          </View>
        );
      })}
    </View>
  );
}
