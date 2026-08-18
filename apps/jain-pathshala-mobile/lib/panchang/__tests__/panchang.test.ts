/**
 * The Panchang schema and the calendar helpers.
 *
 * These used to run against assets/data/panchang-2026.json, asserting things
 * like "the bundled sample has 365 days" and "2026-08-12 is a parv day with a
 * highlight". That file was machine-generated and its Samvatsari was three weeks
 * early, so the suite was certifying the shape of fabricated data — and would
 * have gone green for any wrong year of the same shape. It is deleted, and these
 * tests now run against an openly synthetic fixture instead.
 */
import { describe, expect, it } from "vitest";
import {
  buildPanchangMonthCells,
  indexDaysByDate,
  isValidVridhiPair,
  pakshaLabel,
} from "@/lib/panchang/calendar";
import { panchangYearSchema } from "@/lib/panchang/schema";
import { pickNewerPanchangYear } from "@/lib/panchang/version";
import { makeDay, makeYear } from "./panchang-fixture";

describe("panchangYearSchema", () => {
  it("accepts a well-formed year", () => {
    const parsed = panchangYearSchema.safeParse(makeYear());
    expect(parsed.success).toBe(true);
  });

  it("REFUSES a year with no provenance", () => {
    // §17.6.1 — the whole defence. A year nobody has put their name to must not
    // be loadable by any path: not bundled, not fetched, not restored from cache.
    const { provenance, ...withoutProvenance } = makeYear();
    expect(provenance).toBeDefined();
    expect(panchangYearSchema.safeParse(withoutProvenance).success).toBe(false);
  });

  it("refuses provenance with a blank verifier", () => {
    // An empty string would satisfy "the field exists" while naming nobody.
    const year = makeYear();
    const parsed = panchangYearSchema.safeParse({
      ...year,
      provenance: { ...year.provenance, verified_by: "" },
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a malformed verification date", () => {
    const year = makeYear();
    const parsed = panchangYearSchema.safeParse({
      ...year,
      provenance: { ...year.provenance, verified_at: "last Tuesday" },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("pickNewerPanchangYear", () => {
  const base = makeYear();

  it("prefers higher contentVersion", () => {
    const newer = { ...base, contentVersion: base.contentVersion + 1 };
    expect(pickNewerPanchangYear(newer, base)).toBe(newer);
    expect(pickNewerPanchangYear(base, newer).contentVersion).toBe(newer.contentVersion);
  });

  it("falls back when preferred is null", () => {
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
    const year = makeYear({
      days: [
        ...makeYear().days.slice(0, 11),
        makeDay("2026-08-12", {
          tithi: 8,
          parvTithi: true,
          events: [
            {
              id: "e1",
              type: "festival",
              title_en: "Fixture event",
              title_hi: "परीक्षण",
              title_gu: null,
              note_en: null,
              note_hi: null,
              note_gu: null,
              highlight: true,
              linkedItemId: null,
            },
          ],
        }),
        ...makeYear().days.slice(12),
      ],
    });
    const cells = buildPanchangMonthCells({
      month: "2026-08",
      dayByDate: indexDaysByDate(year),
      todayIso: "2026-08-12",
    });
    expect(cells.length % 7).toBe(0);
    const today = cells.find((c) => c.date === "2026-08-12");
    expect(today?.isToday).toBe(true);
    expect(today?.hasHighlight).toBe(true);
    expect(today?.hasParv).toBe(true);
    // Every real day cell has a gregorian date — vridhi inserts no extra cells.
    expect(cells.filter((c) => c.date)).toHaveLength(31);
  });

  it("still builds a grid when no year has been published", () => {
    // The screen renders this so a reader can open a day and get their
    // Pachchakkhan times even with no transcription — it must not throw or
    // come back short.
    const cells = buildPanchangMonthCells({
      month: "2026-08",
      dayByDate: new Map(),
      todayIso: "2026-08-12",
    });
    expect(cells.length % 7).toBe(0);
    expect(cells.filter((c) => c.date)).toHaveLength(31);
    expect(cells.every((c) => !c.hasParv && !c.hasHighlight)).toBe(true);
    expect(cells.find((c) => c.date === "2026-08-12")?.isToday).toBe(true);
  });
});

describe("tithiStatus handling", () => {
  it("accepts a vridhi day repeating the previous day's tithi", () => {
    const prev = makeDay("2026-08-10", { tithi: 10, paksha: "sud" });
    const vridhi = makeDay("2026-08-11", {
      tithi: 10,
      paksha: "sud",
      tithiStatus: "vridhi",
    });
    expect(isValidVridhiPair(prev, vridhi)).toBe(true);
  });

  it("rejects a vridhi day whose tithi moved on", () => {
    const prev = makeDay("2026-08-10", { tithi: 10, paksha: "sud" });
    const notVridhi = makeDay("2026-08-11", {
      tithi: 11,
      paksha: "sud",
      tithiStatus: "vridhi",
    });
    expect(isValidVridhiPair(prev, notVridhi)).toBe(false);
  });

  it("tolerates a kshay gap, so nothing assumes contiguous tithi numbers", () => {
    // A kshay tithi is skipped entirely: the sequence jumps by 2. Code that
    // assumes +1 per day silently mislabels every day after the first kshay.
    const days = [
      makeDay("2026-08-10", { tithi: 10, paksha: "sud" }),
      makeDay("2026-08-11", { tithi: 12, paksha: "sud", tithiStatus: "kshay" }),
    ];
    const parsed = panchangYearSchema.safeParse(makeYear({ days }));
    expect(parsed.success).toBe(true);
    expect(days[1]!.tithi - days[0]!.tithi).toBe(2);
  });
});
