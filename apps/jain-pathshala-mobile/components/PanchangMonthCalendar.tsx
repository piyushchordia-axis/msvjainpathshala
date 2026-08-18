import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";
import {
  formatMonthLabel,
  jainMonthSpan,
  shiftMonth,
  tithiCellLabel,
  type PanchangDayCell,
} from "@/lib/panchang/calendar";
import type { PanchangMonthMeta } from "@/lib/panchang/schema";
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
          lineHeight: 22,
        }}
      >
        {label}
      </Text>
    </Row>
  );
}

/** Spoken date for a cell — "15 August 2026, Shravan Sud 5, parv tithi". */
function cellAccessibilityLabel(
  cell: PanchangDayCell,
  hi: boolean,
): string {
  if (!cell.date) return "";
  const spokenDate = new Date(`${cell.date}T12:00:00`).toLocaleDateString(
    hi ? "hi-IN" : "en-IN",
    { day: "numeric", month: "long", year: "numeric" },
  );
  const parts = [spokenDate];
  const day = cell.panchangDay;
  if (day) {
    parts.push(
      day.paksha === "sud"
        ? `${hi ? "सुद" : "Sud"} ${day.tithi}`
        : `${hi ? "वद" : "Vad"} ${day.tithi}`,
    );
  }
  // Dots are silent to a screen reader; say what they mean instead.
  if (cell.hasParv) parts.push(hi ? "पर्व तिथि" : "parv tithi");
  if (cell.hasHighlight) parts.push(hi ? "विशेष घटना" : "special event");
  return parts.join(", ");
}

export function PanchangMonthCalendar({
  month,
  onMonthChange,
  cells,
  onDayPress,
  minMonth,
  maxMonth,
  months = [],
}: {
  month: string;
  onMonthChange: (next: string) => void;
  cells: PanchangDayCell[];
  onDayPress: (date: string) => void;
  minMonth?: string;
  maxMonth?: string;
  /** Month vocabulary from the year file — absent when none is published. */
  months?: PanchangMonthMeta[];
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

  const jainSpan = jainMonthSpan(cells, months, hi);

  /*
   * The footnote used to read "vridhi/kshay never break the grid" — an
   * implementation note about the rendering code, shipped to families. It also
   * appeared every month, including the eleven where nothing unusual happens.
   *
   * Now the tithis are IN the cells, a repeated or missing number is visible
   * and does need explaining — but only in the month it actually occurs, and in
   * terms of what the reader is looking at.
   */
  const hasVridhi = cells.some((c2) => c2.panchangDay?.tithiStatus === "vridhi");
  const hasKshay = cells.some((c2) => c2.panchangDay?.tithiStatus === "kshay");

  return (
    <Card>
      <Row style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Pressable
          onPress={() => canBack && onMonthChange(shiftMonth(month, -1))}
          disabled={!canBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canBack }}
          accessibilityLabel={hi ? "पिछला महीना" : "Previous month"}
          style={{
            opacity: canBack ? 1 : 0.35,
            minWidth: 44,
            minHeight: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="chevron-back" size={22} color={c.foreground} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
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
          {/* The Jain month(s) this Gregorian month spans. Absent when no year
              has been published — the grid still works, it just has no tithis
              to name. */}
          {jainSpan ? (
            <Text
              style={{
                fontFamily: bodyFamily(hi),
                fontSize: 13,
                color: c.mutedForeground,
                lineHeight: 22,
                marginTop: 2,
              }}
            >
              {jainSpan}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => canFwd && onMonthChange(shiftMonth(month, 1))}
          disabled={!canFwd}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canFwd }}
          accessibilityLabel={hi ? "अगला महीना" : "Next month"}
          style={{
            opacity: canFwd ? 1 : 0.35,
            minWidth: 44,
            minHeight: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
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
                lineHeight: 22,
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
            const tithi = cell.panchangDay
              ? tithiCellLabel(cell.panchangDay, hi)
              : null;
            return (
              <Pressable
                key={cell.date}
                onPress={() => onDayPress(cell.date!)}
                accessibilityRole="button"
                accessibilityLabel={cellAccessibilityLabel(cell, hi)}
                accessibilityState={{ selected: cell.isToday }}
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
                    lineHeight: 18,
                    color: c.foreground,
                    fontWeight: cell.isToday ? "700" : "400",
                  }}
                >
                  {cell.day}
                </Text>
                {/* The tithi is what a Panchang is for. Without it, finding
                    Ashtami meant opening up to thirty days one at a time. */}
                {tithi ? (
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily: bodyFamily(hi),
                      fontSize: 11,
                      lineHeight: 14,
                      color: cell.hasParv ? c.secondary : c.mutedForeground,
                      fontWeight: cell.hasParv ? "700" : "400",
                    }}
                  >
                    {tithi}
                  </Text>
                ) : null}
                <View style={{ flexDirection: "row", gap: 3, height: 8, marginTop: 1 }}>
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
                  {/* A RING, not a second filled dot: parv and highlight were
                      separable only by hue, which a colour-blind reader cannot
                      do at 6px. */}
                  {cell.hasHighlight ? (
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        borderWidth: 2,
                        borderColor: c.primary,
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
        <LegendDot color={c.primary} ring label={hi ? "विशेष घटना" : "Special event"} />
      </Row>
      {hasVridhi || hasKshay ? (
        <Body muted style={{ marginTop: 8, fontSize: 12, lineHeight: 22 }}>
          {hasVridhi && hasKshay
            ? hi
              ? "इस महीने एक तिथि दो दिन चलती है और एक तिथि नहीं आती — यह पंचांग के अनुसार सही है।"
              : "This month one tithi runs for two days and one does not occur — both are correct for this Panchang."
            : hasVridhi
              ? hi
                ? "इस महीने एक तिथि दो दिन चलती है — यह पंचांग के अनुसार सही है।"
                : "This month one tithi runs for two days — that is correct for this Panchang."
              : hi
                ? "इस महीने एक तिथि नहीं आती — यह पंचांग के अनुसार सही है।"
                : "This month one tithi does not occur — that is correct for this Panchang."}
        </Body>
      ) : null}
    </Card>
  );
}
