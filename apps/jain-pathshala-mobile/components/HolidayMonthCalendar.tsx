import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { useMemo } from "react";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";
import { formatMonthLabel, shiftMonth } from "@/lib/attendance-calendar";
import { Body, Card, Row } from "@/components/ui";

export type HolidayCalendarDay = {
  date: string | null;
  day: number | null;
  isHoliday: boolean;
  inRange: boolean;
  isRangeEdge: boolean;
  /** Before `minDate` — rendered dimmed and not pressable. */
  disabled: boolean;
};

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function buildHolidayMonthCells(opts: {
  month: string;
  holidayDates: Set<string>;
  rangeStart: string | null;
  rangeEnd: string | null;
  minDate?: string | null;
}): HolidayCalendarDay[] {
  const [y, m] = opts.month.split("-").map(Number) as [number, number];
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const totalDays = daysInMonth(opts.month);
  const cells: HolidayCalendarDay[] = [];

  let rangeFrom = opts.rangeStart;
  let rangeTo = opts.rangeEnd ?? opts.rangeStart;
  if (rangeFrom && rangeTo && rangeFrom > rangeTo) {
    const tmp = rangeFrom;
    rangeFrom = rangeTo;
    rangeTo = tmp;
  }

  const pad = (): HolidayCalendarDay => ({
    date: null,
    day: null,
    isHoliday: false,
    inRange: false,
    isRangeEdge: false,
    disabled: false,
  });

  for (let i = 0; i < firstDow; i++) {
    cells.push(pad());
  }

  for (let day = 1; day <= totalDays; day++) {
    const date = `${opts.month}-${String(day).padStart(2, "0")}`;
    const inRange = !!(rangeFrom && rangeTo && date >= rangeFrom && date <= rangeTo);
    const isRangeEdge = !!(rangeFrom && (date === rangeFrom || date === rangeTo));
    cells.push({
      date,
      day,
      isHoliday: opts.holidayDates.has(date),
      inRange,
      isRangeEdge,
      disabled: !!opts.minDate && date < opts.minDate,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push(pad());
  }
  return cells;
}

/**
 * Month grid supporting tap-to-pick of an inclusive start/end range, with
 * existing holidays marked (no native date-picker dependency).
 *
 * Used both for centre holidays (admin) and for parent leave notices, where
 * `minDate` blocks the past: a leave notice for a day that has already gone can
 * never be consumed by the marking UI, so those days are made unpickable rather
 * than rejected after the parent has filled the form.
 */
export function HolidayMonthCalendar({
  month,
  onMonthChange,
  holidayDates,
  rangeStart,
  rangeEnd,
  onDayPress,
  minDate,
  rangeLegendLabel,
}: {
  month: string;
  onMonthChange: (next: string) => void;
  holidayDates: Set<string> | string[];
  rangeStart: string | null;
  rangeEnd: string | null;
  onDayPress?: (date: string) => void;
  /** Earliest selectable YYYY-MM-DD; earlier days render dimmed and inert. */
  minDate?: string | null;
  /** Overrides the "Selected range" legend wording. */
  rangeLegendLabel?: string;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const holidaySet = useMemo(
    () => (holidayDates instanceof Set ? holidayDates : new Set(holidayDates)),
    [holidayDates],
  );
  const cells = useMemo(
    () =>
      buildHolidayMonthCells({
        month,
        holidayDates: holidaySet,
        rangeStart,
        rangeEnd,
        minDate,
      }),
    [month, holidaySet, rangeStart, rangeEnd, minDate],
  );
  // Nothing selectable before minDate's month, so stop the parent going there.
  const canGoBack = !minDate || month > minDate.slice(0, 7);

  const weekdays = hi
    ? ["सो", "मं", "बु", "गु", "शु", "श", "र"]
    : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  const weeks: HolidayCalendarDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  return (
    <Card style={{ gap: 12 }}>
      <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
        <Pressable
          onPress={() => {
            if (canGoBack) onMonthChange(shiftMonth(month, -1));
          }}
          hitSlop={12}
          disabled={!canGoBack}
          accessibilityLabel={hi ? "पिछला माह" : "Previous month"}
        >
          <Ionicons name="chevron-back" size={22} color={canGoBack ? c.foreground : c.inkDim} />
        </Pressable>
        <Text
          style={{
            fontFamily: bodyFamily(hi, "semibold"),
            fontSize: 16,
            lineHeight: 22,
            color: c.foreground,
            minWidth: 140,
            textAlign: "center",
          }}
        >
          {formatMonthLabel(month, hi)}
        </Text>
        <Pressable
          onPress={() => onMonthChange(shiftMonth(month, 1))}
          hitSlop={12}
          accessibilityLabel={hi ? "अगला माह" : "Next month"}
        >
          <Ionicons name="chevron-forward" size={22} color={c.foreground} />
        </Pressable>
      </Row>

      <Row style={{ flexWrap: "wrap", gap: 10 }}>
        <Row style={{ alignItems: "center", gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: c.mutedForeground }} />
          <Text style={{ fontFamily: bodyFamily(hi), fontSize: 11, color: c.mutedForeground, lineHeight: 16 }}>
            {hi ? "अवकाश" : "Holiday"}
          </Text>
        </Row>
        <Row style={{ alignItems: "center", gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: c.primary }} />
          <Text style={{ fontFamily: bodyFamily(hi), fontSize: 11, color: c.mutedForeground, lineHeight: 16 }}>
            {rangeLegendLabel ?? (hi ? "चयनित सीमा" : "Selected range")}
          </Text>
        </Row>
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
              const bg = cell.isRangeEdge
                ? c.primary
                : cell.inRange
                  ? c.accent
                  : cell.isHoliday
                    ? c.muted
                    : "transparent";
              const fg = cell.isRangeEdge
                ? c.primaryForeground
                : cell.inRange
                  ? c.accentForeground
                  : cell.isHoliday
                    ? c.mutedForeground
                    : c.foreground;
              return (
                <Pressable
                  key={cell.date}
                  onPress={() => onDayPress?.(cell.date!)}
                  disabled={cell.disabled}
                  accessibilityRole="button"
                  accessibilityLabel={cell.date}
                  accessibilityState={{ disabled: cell.disabled, selected: cell.inRange }}
                  style={{ flex: 1, aspectRatio: 1, padding: 2, opacity: cell.disabled ? 0.35 : 1 }}
                >
                  <View
                    style={{
                      flex: 1,
                      borderRadius: 8,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: bg,
                      borderWidth: cell.isHoliday && !cell.inRange ? 1 : 0,
                      borderColor: c.border,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: bodyFamily(
                          hi,
                          cell.isHoliday || cell.inRange ? "semibold" : "regular",
                        ),
                        fontSize: 13,
                        color: fg,
                      }}
                    >
                      {cell.day}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </Card>
  );
}

/** Inclusive YYYY-MM-DD expansion (UTC calendar days). */
export function expandInclusiveDateRange(start: string, end: string): string[] {
  let from = start;
  let to = end;
  if (from > to) {
    const tmp = from;
    from = to;
    to = tmp;
  }
  const out: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  const cursor = new Date(Date.UTC(fy, fm - 1, fd));
  const endDate = new Date(Date.UTC(ty, tm - 1, td));
  while (cursor <= endDate) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
