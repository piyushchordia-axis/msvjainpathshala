import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";
import {
  formatMonthLabel,
  shiftMonth,
  type PanchangDayCell,
} from "@/lib/panchang/calendar";
import { Body, Card, Row } from "@/components/ui";

function LegendDot({
  color,
  label,
  ring,
}: {
  color: string;
  label: string;
  ring?: boolean;
}) {
  const c = useColors();
  const { hi } = useLocale();
  return (
    <Row style={{ alignItems: "center", gap: 4 }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          backgroundColor: ring ? "transparent" : color,
          borderWidth: ring ? 2 : 0,
          borderColor: color,
        }}
      />
      <Text
        style={{
          fontFamily: bodyFamily(hi),
          fontSize: 11,
          color: c.mutedForeground,
          lineHeight: 16,
        }}
      >
        {label}
      </Text>
    </Row>
  );
}

export function PanchangMonthCalendar({
  month,
  onMonthChange,
  cells,
  onDayPress,
  minMonth,
  maxMonth,
}: {
  month: string;
  onMonthChange: (next: string) => void;
  cells: PanchangDayCell[];
  onDayPress: (date: string) => void;
  minMonth?: string;
  maxMonth?: string;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const canBack = !minMonth || month > minMonth;
  const canFwd = !maxMonth || month < maxMonth;
  const weekdays = hi
    ? ["सो", "मं", "बु", "गु", "शु", "श", "र"]
    : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  const weeks: PanchangDayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  return (
    <Card>
      <Row style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Pressable
          onPress={() => canBack && onMonthChange(shiftMonth(month, -1))}
          disabled={!canBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={hi ? "पिछला महीना" : "Previous month"}
          style={{ opacity: canBack ? 1 : 0.35, padding: 4 }}
        >
          <Ionicons name="chevron-back" size={22} color={c.foreground} />
        </Pressable>
        <Text
          style={{
            fontFamily: bodyFamily(hi),
            fontSize: 16,
            fontWeight: "600",
            color: c.foreground,
            lineHeight: 22,
          }}
        >
          {formatMonthLabel(month, hi)}
        </Text>
        <Pressable
          onPress={() => canFwd && onMonthChange(shiftMonth(month, 1))}
          disabled={!canFwd}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={hi ? "अगला महीना" : "Next month"}
          style={{ opacity: canFwd ? 1 : 0.35, padding: 4 }}
        >
          <Ionicons name="chevron-forward" size={22} color={c.foreground} />
        </Pressable>
      </Row>

      <Row style={{ marginBottom: 6 }}>
        {weekdays.map((w) => (
          <View key={w} style={{ flex: 1, alignItems: "center" }}>
            <Text
              style={{
                fontFamily: bodyFamily(hi),
                fontSize: 11,
                color: c.mutedForeground,
                lineHeight: 16,
              }}
            >
              {w}
            </Text>
          </View>
        ))}
      </Row>

      {weeks.map((week, wi) => (
        <Row key={wi} style={{ marginBottom: 4 }}>
          {week.map((cell, ci) => {
            if (!cell.date || cell.day == null) {
              return <View key={`pad-${wi}-${ci}`} style={{ flex: 1, aspectRatio: 1 }} />;
            }
            return (
              <Pressable
                key={cell.date}
                onPress={() => onDayPress(cell.date!)}
                accessibilityRole="button"
                accessibilityLabel={cell.date}
                style={{
                  flex: 1,
                  aspectRatio: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  backgroundColor: cell.isToday ? c.accent : "transparent",
                  borderWidth: cell.isToday ? 1 : 0,
                  borderColor: c.primary,
                }}
              >
                <Text
                  style={{
                    fontFamily: bodyFamily(hi),
                    fontSize: 14,
                    lineHeight: 20,
                    color: c.foreground,
                    fontWeight: cell.isToday ? "700" : "400",
                  }}
                >
                  {cell.day}
                </Text>
                <View style={{ flexDirection: "row", gap: 3, height: 8, marginTop: 2 }}>
                  {cell.hasParv ? (
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        backgroundColor: c.secondary,
                      }}
                    />
                  ) : null}
                  {cell.hasHighlight ? (
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        backgroundColor: c.primary,
                      }}
                    />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </Row>
      ))}

      <Row style={{ marginTop: 10, gap: 16, flexWrap: "wrap" }}>
        <LegendDot color={c.secondary} label={hi ? "पर्व तिथि" : "Parv tithi"} />
        <LegendDot color={c.primary} label={hi ? "विशेष घटना" : "Highlight"} />
      </Row>
      <Body muted style={{ marginTop: 8, fontSize: 12, lineHeight: 18 }}>
        {hi
          ? "तिथि क्रम निरंतर नहीं होता — वृद्धि / क्षय के दिन ग्रिड नहीं टूटता।"
          : "Tithi numbers are not always contiguous — vridhi/kshay never break the grid."}
      </Body>
    </Card>
  );
}
