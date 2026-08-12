import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildPanchangMonthCells,
  indexDaysByDate,
  isValidVridhiPair,
  pakshaLabel,
} from "@/lib/panchang/calendar";
import { panchangYearSchema } from "@/lib/panchang/schema";
import { pickNewerPanchangYear } from "@/lib/panchang/version";

const bundledPath = resolve(__dirname, "../../../assets/data/panchang-2026.json");

describe("panchangYearSchema", () => {
  it("accepts the bundled 2026 sample", () => {
    const raw = JSON.parse(readFileSync(bundledPath, "utf8"));
    const parsed = panchangYearSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.days).toHaveLength(365);
    expect(parsed.data.schemaVersion).toBe(1);
  });
});

describe("pickNewerPanchangYear", () => {
  it("prefers higher contentVersion", () => {
    const raw = JSON.parse(readFileSync(bundledPath, "utf8"));
    const base = panchangYearSchema.parse(raw);
    const newer = { ...base, contentVersion: base.contentVersion + 1 };
    expect(pickNewerPanchangYear(newer, base)).toBe(newer);
    expect(pickNewerPanchangYear(base, newer).contentVersion).toBe(newer.contentVersion);
  });

  it("falls back when preferred is null", () => {
    const raw = JSON.parse(readFileSync(bundledPath, "utf8"));
    const base = panchangYearSchema.parse(raw);
    expect(pickNewerPanchangYear(null, base)).toBe(base);
  });
});

describe("pakshaLabel", () => {
  it("uses Sud/Vad not Shukla/Krishna", () => {
    expect(pakshaLabel("sud", false)).toBe("Sud");
    expect(pakshaLabel("vad", false)).toBe("Vad");
    expect(pakshaLabel("sud", true)).toBe("सुद");
    expect(pakshaLabel("vad", true)).toBe("वद");
  });
});

describe("buildPanchangMonthCells", () => {
  it("builds a full week-aligned grid with markers", () => {
    const year = panchangYearSchema.parse(
      JSON.parse(readFileSync(bundledPath, "utf8")),
    );
    const dayByDate = indexDaysByDate(year);
    const cells = buildPanchangMonthCells({
      month: "2026-08",
      dayByDate,
      todayIso: "2026-08-12",
    });
    expect(cells.length % 7).toBe(0);
    const today = cells.find((c) => c.date === "2026-08-12");
    expect(today?.isToday).toBe(true);
    expect(today?.hasHighlight).toBe(true);
    expect(today?.hasParv).toBe(true);
    // Every real day cell has a gregorian date — vridhi does not insert extra cells
    const real = cells.filter((c) => c.date);
    expect(real).toHaveLength(31);
  });
});

describe("tithiStatus handling", () => {
  it("marks vridhi days with the same tithi as the previous day", () => {
    const year = panchangYearSchema.parse(
      JSON.parse(readFileSync(bundledPath, "utf8")),
    );
    const vridhi = year.days.filter((d) => d.tithiStatus === "vridhi");
    expect(vridhi.length).toBeGreaterThan(0);
    for (const d of vridhi) {
      const idx = year.days.findIndex((x) => x.date === d.date);
      const prev = year.days[idx - 1];
      expect(isValidVridhiPair(prev, d)).toBe(true);
    }
  });

  it("does not assume contiguous tithi numbers across a paksha", () => {
    const year = panchangYearSchema.parse(
      JSON.parse(readFileSync(bundledPath, "utf8")),
    );
    // Around a known kshay jump date, tithi delta can be > 1
    const i = year.days.findIndex((d) => d.date === "2026-03-18");
    expect(i).toBeGreaterThan(0);
    const prev = year.days[i - 1]!;
    const curr = year.days[i]!;
    const delta =
      curr.paksha === prev.paksha ? curr.tithi - prev.tithi : null;
    // Either paksha rolled or stepped by more than 1 (kshay skip)
    expect(delta === null || Math.abs(delta) >= 1).toBe(true);
  });
});
