import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";
import {
  type CalendarDayCell,
  formatMonthLabel,
  shiftMonth,
} from "@/lib/attendance-calendar";
import { Body, Card, Row } from "@/components/ui";

function cellAccent(
  cell: CalendarDayCell,
  c: ReturnType<typeof useColors>,
): { bg: string; fg: string; border: string } {
  if (cell.markStatus === "present") {
    return { bg: c.successSoft, fg: c.successText, border: c.successSoft };
  }
  if (cell.onLeave) {
    return { bg: c.accent, fg: c.accentForeground, border: c.accent };
  }
  if (cell.isHoliday) {
    return { bg: c.muted, fg: c.mutedForeground, border: c.border };
  }
  return { bg: "transparent", fg: c.foreground, border: "transparent" };
}

function LegendDot({ color, label }: { color: string; label: string }) {
  const c = useColors();
  const { hi } = useLocale();
  return (
    <Row style={{ alignItems: "center", gap: 4 }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          backgroundColor: color,
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

export function AttendanceMonthCalendar({
  month,
  onMonthChange,
  maxMonth,
  cells,
}: {
  month: string;
  onMonthChange: (next: string) => void;
  maxMonth: string;
  cells: CalendarDayCell[];
}) {
  const c = useColors();
  const { hi } = useLocale();
  const canGoForward = month < maxMonth;
  const weekdays = hi
    ? ["सो", "मं", "बु", "गु", "शु", "श", "र"]
    : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  return (
    <Card style={{ gap: 12 }}>
      <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
        <Pressable
          onPress={() => onMonthChange(shiftMonth(month, -1))}
          hitSlop={12}
          accessibilityLabel={hi ? "पिछला माह" : "Previous month"}
        >
          <Ionicons name="chevron-back" size={22} color={c.foreground} />
        </Pressable>
        <Text
          style={{
            fontFamily: bodyFamily(hi, "semibold"),
            fontSize: 16,
            color: c.foreground,
            minWidth: 140,
            textAlign: "center",
          }}
        >
          {formatMonthLabel(month, hi)}
        </Text>
        <Pressable
          onPress={() => {
            if (canGoForward) onMonthChange(shiftMonth(month, 1));
          }}
          hitSlop={12}
          disabled={!canGoForward}
          accessibilityLabel={hi ? "अगला माह" : "Next month"}
        >
          <Ionicons
            name="chevron-forward"
            size={22}
            color={canGoForward ? c.foreground : c.inkDim}
          />
        </Pressable>
      </Row>

      <Row style={{ flexWrap: "wrap", gap: 10 }}>
        <LegendDot color={c.successText} label={hi ? "उपस्थित" : "Present"} />
        <LegendDot color={c.primary} label={hi ? "अवकाश" : "Leave"} />
        <LegendDot color={c.mutedForeground} label={hi ? "छुट्टी" : "Holiday"} />
      </Row>

      <View style={{ flexDirection: "row" }}>
        {weekdays.map((d) => (
          <View key={d} style={{ flex: 1, alignItems: "center", paddingBottom: 6 }}>
            <Body muted style={{ fontSize: 11 }}>
              {d}
            </Body>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {cells.map((cell, idx) => {
          if (!cell.date || cell.day == null) {
            return <View key={`pad-${idx}`} style={{ width: `${100 / 7}%`, aspectRatio: 1 }} />;
          }
          const accent = cellAccent(cell, c);
          const hasEvent = !!(cell.markStatus || cell.onLeave || cell.isHoliday);
          return (
            <View
              key={cell.date}
              style={{
                width: `${100 / 7}%`,
                aspectRatio: 1,
                padding: 2,
              }}
            >
              <View
                style={{
                  flex: 1,
                  borderRadius: 8,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: hasEvent ? accent.bg : "transparent",
                  borderWidth: cell.isHoliday && cell.markStatus ? 1.5 : 0,
                  borderColor: cell.isHoliday && cell.markStatus ? c.border : "transparent",
                }}
              >
                <Text
                  style={{
                    fontFamily: bodyFamily(hi, hasEvent ? "semibold" : "regular"),
                    fontSize: 13,
                    color: hasEvent ? accent.fg : c.foreground,
                  }}
                >
                  {cell.day}
                </Text>
                {cell.isHoliday && cell.markStatus ? (
                  <View
                    style={{
                      position: "absolute",
                      bottom: 3,
                      width: 4,
                      height: 4,
                      borderRadius: 999,
                      backgroundColor: c.mutedForeground,
                    }}
                  />
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}
