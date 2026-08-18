/**
 * What a Panchang cell and month header say.
 *
 * The grid rendered a Gregorian day number and up to two 6px dots. For a
 * Panchang the tithi at a glance IS the product, and it was already on the cell
 * — PanchangDayCell carries the whole PanchangDay. The month header named only
 * the Gregorian month, so an adhik maas stayed invisible until a day was opened.
 */
import { describe, expect, it } from "vitest";
import {
  buildPanchangMonthCells,
  indexDaysByDate,
  jainMonthSpan,
  tithiCellLabel,
} from "@/lib/panchang/calendar";
import { makeDay, makeYear } from "./panchang-fixture";

/**
 * Real display names, unlike the shared fixture's key-as-name — this suite is
 * about what a reader SEES, so the month vocabulary has to be the presentable
 * one.
 */
const MONTHS = [
  { key: "shravan", name_en: "Shravan", name_hi: "श्रावण", name_gu: null },
  { key: "bhadarvo", name_en: "Bhadarvo", name_hi: "भाद्रवो", name_gu: null },
];

describe("tithiCellLabel", () => {
  it("distinguishes paksha in the label, not by colour", () => {
    // Sud 5 and Vad 5 are different days. A hue difference at 11px does not
    // survive a monochrome screen or a colour-blind reader.
    expect(tithiCellLabel(makeDay("2026-08-05", { paksha: "sud", tithi: 5 }), false)).toBe("S 5");
    expect(tithiCellLabel(makeDay("2026-08-20", { paksha: "vad", tithi: 5 }), false)).toBe("V 5");
  });

  it("uses Devanagari in Hindi", () => {
    expect(tithiCellLabel(makeDay("2026-08-05", { paksha: "sud", tithi: 8 }), true)).toBe("स 8");
    expect(tithiCellLabel(makeDay("2026-08-20", { paksha: "vad", tithi: 14 }), true)).toBe("व 14");
  });
});

describe("jainMonthSpan", () => {
  function cellsFor(month: string, days: ReturnType<typeof makeDay>[]) {
    return buildPanchangMonthCells({
      month,
      dayByDate: indexDaysByDate(makeYear({ months: MONTHS, days })),
      todayIso: "2026-08-01",
    });
  }

  it("names both Jain months a Gregorian month straddles", () => {
    const cells = cellsFor("2026-08", [
      makeDay("2026-08-05", { month: "shravan" }),
      makeDay("2026-08-25", { month: "bhadarvo" }),
    ]);
    expect(jainMonthSpan(cells, MONTHS, false)).toBe("Shravan–Bhadarvo");
  });

  it("names one when the month does not straddle", () => {
    const cells = cellsFor("2026-08", [makeDay("2026-08-05", { month: "shravan" })]);
    expect(jainMonthSpan(cells, MONTHS, false)).toBe("Shravan");
  });

  it("surfaces an adhik maas at MONTH level", () => {
    // The whole reason this exists: an extra month is the single most
    // consequential thing a Panchang says, and it was reachable only by
    // opening a day.
    const cells = cellsFor("2026-08", [
      makeDay("2026-08-05", { month: "shravan", isAdhikMaas: true }),
    ]);
    expect(jainMonthSpan(cells, MONTHS, false)).toBe("Adhik Shravan");
    expect(jainMonthSpan(cells, MONTHS, true)).toContain("अधिक");
  });

  it("returns null when no year is published", () => {
    // Not "unknown month" — the header simply says nothing extra, and the grid
    // still works.
    const cells = cellsFor("2026-08", []);
    expect(jainMonthSpan(cells, MONTHS, false)).toBeNull();
  });

  it("does not repeat a month that appears on many days", () => {
    const cells = cellsFor("2026-08", [
      makeDay("2026-08-05", { month: "shravan" }),
      makeDay("2026-08-06", { month: "shravan" }),
      makeDay("2026-08-07", { month: "shravan" }),
    ]);
    expect(jainMonthSpan(cells, MONTHS, false)).toBe("Shravan");
  });
});
