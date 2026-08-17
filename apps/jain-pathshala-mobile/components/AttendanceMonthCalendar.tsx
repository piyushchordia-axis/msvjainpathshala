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

/** `ring` draws an outline instead of a fill — matches today's ring on the grid. */
function LegendDot({
  color,
  label,
  ring = false,
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
          width: ring ? 10 : 8,
          height: ring ? 10 : 8,
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
  // Week rows with flex:1 — percentage width + flexWrap rounds past 100% and
  // wraps the Sunday column onto the next line.
  const weeks: CalendarDayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

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
        <LegendDot color={c.primary} label={hi ? "आज" : "Today"} ring />
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

      <View>
        {weeks.map((week, weekIdx) => (
          <View key={`week-${weekIdx}`} style={{ flexDirection: "row" }}>
            {week.map((cell, colIdx) => {
              const idx = weekIdx * 7 + colIdx;
              if (!cell.date || cell.day == null) {
                return <View key={`pad-${idx}`} style={{ flex: 1, aspectRatio: 1 }} />;
              }
              const accent = cellAccent(cell, c);
              const hasEvent = !!(cell.markStatus || cell.onLeave || cell.isHoliday);
              return (
                <View
                  key={cell.date}
                  style={{
                    flex: 1,
                    aspectRatio: 1,
                    padding: 2,
                  }}
                >
                  <View
                    style={{
                      flex: 1,
                      // Circular so today's ring reads as a ring, not a box.
                      borderRadius: 999,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: hasEvent ? accent.bg : "transparent",
                      borderWidth: cell.isHoliday && cell.markStatus ? 1.5 : 0,
                      borderColor: cell.isHoliday && cell.markStatus ? c.border : "transparent",
                    }}
                  >
                    {/* Today's ring sits on its own layer: the tile's own border is
                        already spoken for by the holiday+present combination, and an
                        overlay keeps the ring visible on every event colour. */}
                    {cell.isToday ? (
                      <View
                        pointerEvents="none"
                        style={{
                          position: "absolute",
                          top: 0,
                          right: 0,
                          bottom: 0,
                          left: 0,
                          borderRadius: 999,
                          borderWidth: 2,
                          borderColor: c.primary,
                        }}
                      />
                    ) : null}
                    <Text
                      style={{
                        fontFamily: bodyFamily(
                          hi,
                          hasEvent || cell.isToday ? "semibold" : "regular",
                        ),
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
        ))}
      </View>
    </Card>
  );
}
