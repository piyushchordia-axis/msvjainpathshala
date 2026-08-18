/**
 * The anchor rules — the check that would have caught the shipped 2026 file.
 *
 * Every case below is planted from the ACTUAL contents of
 * assets/data/panchang-2026.json, so this suite is a regression test against
 * that specific failure rather than an abstract exercise: Samvatsari on Shravan
 * Vad 14, Mahavir Jayanti on Phalgun Sud 10, Akshaya Tritiya on a Vad 8, Diwali
 * on Kartik Sud 2, a Digambar "Das Lakshan ends" inside a Shwetambar year, Hindi
 * civil month keys, parvTithi set only for 8/14/15, and nine events in a year.
 *
 * The rules themselves are a review checklist, not an authority — see the
 * comment on ANCHORS in @workspace/api-zod. They catch a transcription slip;
 * they do not make an unverified year correct.
 */
import { describe, expect, it } from "vitest";
import { panchangAnchorIssues } from "@/lib/panchang/schema";
import type { PanchangDay, PanchangYear } from "@/lib/panchang/schema";
import { makeDay, makeEvent, makeYear, FIXTURE_MONTHS } from "./panchang-fixture";

/** Rule ids raised by a year, for compact assertions. */
function rules(year: PanchangYear): string[] {
  return [...new Set(panchangAnchorIssues(year).map((i) => i.rule))].sort();
}

function dayWith(
  date: string,
  title: string,
  over: Partial<PanchangDay> = {},
): PanchangDay {
  return makeDay(date, {
    ...over,
    events: [makeEvent({ id: `evt-${date}`, title_en: title, title_hi: title })],
  });
}

/**
 * A year that satisfies every rule, so each test below can break exactly one
 * thing and attribute the result.
 */
function goodYear(over: Partial<PanchangYear> = {}): PanchangYear {
  const days: PanchangDay[] = [
    dayWith("2026-08-05", "Paryushan starts", { month: "shravan", paksha: "vad", tithi: 12 }),
    ...Array.from({ length: 6 }, (_, i) =>
      makeDay(`2026-08-0${6 + i}`, { month: "bhadarvo", paksha: "sud", tithi: i + 1 }),
    ),
    dayWith("2026-08-12", "Samvatsari", { month: "bhadarvo", paksha: "sud", tithi: 4 }),
    dayWith("2026-04-19", "Mahavir Jayanti", { month: "chaitra", paksha: "sud", tithi: 13 }),
    dayWith("2026-11-10", "Jain New Year", { month: "kartak", paksha: "sud", tithi: 1 }),
    dayWith("2026-11-09", "Diwali (Mahavir Nirvana)", { month: "aso", paksha: "vad", tithi: 15 }),
    dayWith("2026-11-24", "Kartik Purnima", { month: "kartak", paksha: "sud", tithi: 15 }),
    dayWith("2026-04-30", "Akshaya Tritiya", { month: "vaishakh", paksha: "sud", tithi: 3 }),
    // Enough events, including kalyanaks, to satisfy PV9.
    ...Array.from({ length: 10 }, (_, i) =>
      makeDay(`2026-06-${String(i + 1).padStart(2, "0")}`, {
        month: "jeth",
        paksha: "sud",
        tithi: ((i + 1) % 15) + 1,
        events: [
          makeEvent({ id: `k-${i}`, type: "kalyanak", title_en: `Kalyanak ${i}`, title_hi: "कल्याणक" }),
        ],
      }),
    ),
  ];
  return makeYear({ months: FIXTURE_MONTHS, days, ...over });
}

/** Replace the day carrying `title` with one placed differently. */
function movedTo(
  year: PanchangYear,
  title: string,
  where: Pick<PanchangDay, "month" | "paksha" | "tithi">,
): PanchangYear {
  return {
    ...year,
    days: year.days.map((d) =>
      d.events.some((e) => e.title_en.includes(title)) ? { ...d, ...where } : d,
    ),
  };
}

describe("panchangAnchorIssues", () => {
  it("passes a year that contradicts nothing", () => {
    expect(panchangAnchorIssues(goodYear())).toEqual([]);
  });

  it("PV1 — catches the shipped Samvatsari, three weeks early", () => {
    // The exact defect: Shravan Vad 14 instead of Bhadarvo Sud 4.
    const bad = movedTo(goodYear(), "Samvatsari", {
      month: "shravan",
      paksha: "vad",
      tithi: 14,
    });
    const issues = panchangAnchorIssues(bad);
    expect(issues.some((i) => i.rule === "PV1")).toBe(true);
    expect(issues.find((i) => i.rule === "PV1")!.message).toContain("bhadarvo sud 4");
  });

  it("PV2 — catches Paryushan not ending on Samvatsari", () => {
    // The shipped file started Paryushan on Shravan Vad 8, seven days before a
    // Samvatsari that was itself wrong. The rule counts POSITIONS between the
    // two days rather than tithis, because a kshay or vridhi day inside the
    // eight would make tithi arithmetic lie.
    const year = goodYear();
    const bad = {
      ...year,
      days: year.days.filter((d) => d.date !== "2026-08-08" && d.date !== "2026-08-09"),
    };
    const issue = panchangAnchorIssues(bad).find((i) => i.rule === "PV2");
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("expected 7");
  });

  it("PV3 — catches Mahavir Jayanti off Chaitra Sud 13", () => {
    // The shipped file had it on Phalgun Sud 10.
    const bad = movedTo(goodYear(), "Mahavir Jayanti", {
      month: "fagan",
      paksha: "sud",
      tithi: 10,
    });
    expect(rules(bad)).toContain("PV3");
  });

  it("PV4 — catches Diwali off the amavasya", () => {
    const bad = movedTo(goodYear(), "Diwali", { month: "kartak", paksha: "sud", tithi: 2 });
    expect(rules(bad)).toContain("PV4");
  });

  it("PV5 — catches Akshaya Tritiya on a vad tithi", () => {
    const bad = movedTo(goodYear(), "Akshaya Tritiya", {
      month: "shravan",
      paksha: "vad",
      tithi: 8,
    });
    expect(rules(bad)).toContain("PV5");
  });

  it("PV6 — catches the Hindi civil month names", () => {
    // kartik/margshirsh/paush/… are a different calendar with different month
    // boundaries; a year labelled with them cannot be read against the source.
    const bad = goodYear({
      months: [
        { key: "kartik", name_en: "Kartik", name_hi: "कार्तिक", name_gu: null },
        { key: "margshirsh", name_en: "Margshirsh", name_hi: "मार्गशीर्ष", name_gu: null },
      ],
    });
    const issues = panchangAnchorIssues(bad).filter((i) => i.rule === "PV6");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.message).toContain("kartik");
  });

  it("PV7 — catches a Digambar observance in a Shwetambar year", () => {
    const year = goodYear();
    const bad = {
      ...year,
      days: [...year.days, dayWith("2026-09-14", "Das Lakshan ends")],
    };
    expect(rules(bad)).toContain("PV7");
  });

  it("PV7 — allows it when the year is not Shwetambar", () => {
    const year = goodYear({ sect: "digambar" });
    const bad = {
      ...year,
      days: [...year.days, dayWith("2026-09-14", "Das Lakshan ends")],
    };
    expect(rules(bad)).not.toContain("PV7");
  });

  it("PV8 — catches parv days with no marker", () => {
    // The generator set parvTithi for 8/14/15 only, so Bij, Pancham and
    // Ekadashi lost the dot families look for.
    const year = goodYear();
    const bad = {
      ...year,
      days: year.days.map((d) => ({ ...d, parvTithi: [8, 14, 15].includes(d.tithi) })),
    };
    const issues = panchangAnchorIssues(bad).filter((i) => i.rule === "PV8");
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toContain("parvTithi");
  });

  it("PV9 — catches a year with nine events and no kalyanaks", () => {
    const bad = goodYear({
      days: goodYear().days.filter((d) => !d.events.some((e) => e.type === "kalyanak")),
    });
    const messages = panchangAnchorIssues(bad)
      .filter((i) => i.rule === "PV9")
      .map((i) => i.message)
      .join(" ");
    expect(messages).toContain("at least 16");
    expect(messages).toContain("Panch Kalyanak");
  });

  it("reports every problem at once, not just the first", () => {
    // Whoever is repairing a transcription wants the whole list rather than one
    // upload per error.
    let bad = movedTo(goodYear(), "Samvatsari", { month: "shravan", paksha: "vad", tithi: 14 });
    bad = movedTo(bad, "Mahavir Jayanti", { month: "fagan", paksha: "sud", tithi: 10 });
    bad = movedTo(bad, "Diwali", { month: "kartak", paksha: "sud", tithi: 2 });
    expect(rules(bad)).toEqual(expect.arrayContaining(["PV1", "PV3", "PV4"]));
  });

  it("says nothing about a festival that is simply absent", () => {
    // Absence is PV9's business. A partial transcription in progress should not
    // be told its Diwali is on the wrong day when it has no Diwali yet.
    const year = goodYear();
    const withoutDiwali = {
      ...year,
      days: year.days.filter((d) => !d.events.some((e) => e.title_en.includes("Diwali"))),
    };
    expect(rules(withoutDiwali)).not.toContain("PV4");
  });
});
