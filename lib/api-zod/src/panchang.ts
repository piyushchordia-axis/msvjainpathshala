/**
 * The Panchang year contract — one copy, shared by the API and the mobile app.
 *
 * It lived in two places before (apps/api-server/src/lib/panchang-schema.ts and
 * apps/jain-pathshala-mobile/lib/panchang/schema.ts), byte-identical and free to
 * drift. That is not a tidiness complaint: the rule this file now carries is
 * that a Panchang year must bring proof of who verified it, and a rule with two
 * copies is a rule one copy will eventually not have.
 */
import { z } from "zod";

export const panchangPakshaSchema = z.enum(["sud", "vad"]);
export const panchangTithiStatusSchema = z.enum(["normal", "kshay", "vridhi"]);

/**
 * §17.6.2 — the Shwetambar month names, in order from Kartak.
 *
 * The shipped 2026 file used Hindi civil month names (kartik, margshirsh, paush,
 * magh, phalgun, jyeshtha, bhadrapad, ashwin). Those belong to a different
 * calendar with different month boundaries, so a year labelled with them cannot
 * be checked against a printed Tapagachh Panchang at all.
 */
export const SHWETAMBAR_MONTH_KEYS = [
  "kartak",
  "magsar",
  "posh",
  "maha",
  "fagan",
  "chaitra",
  "vaishakh",
  "jeth",
  "ashadh",
  "shravan",
  "bhadarvo",
  "aso",
] as const;

export type ShwetambarMonthKey = (typeof SHWETAMBAR_MONTH_KEYS)[number];

/**
 * §17.6.1 — who transcribed this year, from what, and who checked it.
 *
 * REQUIRED, and required for a reason. The previous year payload was produced by
 * arithmetic tithi progression, from a script whose own header read
 * "Illustrative anchors — not astronomical truth", and nothing in the SHAPE of
 * the data told it apart from a real transcription. Making provenance part of
 * the schema means a computed year cannot be loaded by any path — bundled,
 * uploaded or cached — without a person putting their name to it.
 */
export const panchangProvenanceSchema = z.object({
  /** The printed Panchang this was transcribed from, including edition. */
  source_publication: z.string().min(1),
  /** Vikram Samvat of the source publication, as printed on it. */
  source_year: z.string().min(1),
  transcribed_by: z.string().min(1),
  /** The named authority who checked it against the source — §17.6.1. */
  verified_by: z.string().min(1),
  verified_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const panchangEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title_en: z.string(),
  title_hi: z.string(),
  title_gu: z.string().nullable().optional(),
  note_en: z.string().nullable(),
  note_hi: z.string().nullable(),
  note_gu: z.string().nullable().optional(),
  highlight: z.boolean(),
  linkedItemId: z.string().uuid().nullable(),
});

export const panchangDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vaar: z.string().min(1),
  month: z.string().min(1),
  isAdhikMaas: z.boolean(),
  paksha: panchangPakshaSchema,
  tithi: z.number().int().min(1).max(15),
  tithiKey: z.string().min(1),
  tithiStatus: panchangTithiStatusSchema,
  nakshatra: z.string().min(1),
  parvTithi: z.boolean(),
  events: z.array(panchangEventSchema),
});

export const panchangMonthMetaSchema = z.object({
  key: z.string().min(1),
  name_en: z.string(),
  name_hi: z.string(),
  name_gu: z.string().nullable().optional(),
  isAdhik: z.boolean().optional(),
});

export const panchangYearSchema = z.object({
  schemaVersion: z.number().int().positive(),
  contentVersion: z.number().int().positive(),
  sect: z.string().min(1),
  vikramSamvat: z.number().int(),
  veerSamvat: z.number().int(),
  year: z.number().int().optional(),
  provenance: panchangProvenanceSchema,
  months: z.array(panchangMonthMetaSchema).min(1),
  days: z.array(panchangDaySchema).min(1),
});

export type PanchangProvenance = z.infer<typeof panchangProvenanceSchema>;
export type PanchangEvent = z.infer<typeof panchangEventSchema>;
export type PanchangDay = z.infer<typeof panchangDaySchema>;
export type PanchangMonthMeta = z.infer<typeof panchangMonthMetaSchema>;
export type PanchangYear = z.infer<typeof panchangYearSchema>;
export type PanchangPaksha = z.infer<typeof panchangPakshaSchema>;
export type PanchangTithiStatus = z.infer<typeof panchangTithiStatusSchema>;

/** Aliases the API server already imports by these names. */
export type PanchangYearPayload = PanchangYear;
export type PanchangDayPayload = PanchangDay;

/* -- Anchor validation ----------------------------------------------------- */

export type PanchangAnchorIssue = {
  /** PV1..PV9 — quoted back in the API error so a reviewer knows which rule bit. */
  rule: string;
  message: string;
};

/**
 * The parv tithis a Shwetambar Panchang marks.
 *
 * The generated file set parvTithi for 8, 14 and 15 only, so the marker was
 * missing from Bij, Pancham and Ekadashi — days families plan fasts around.
 */
const PARV_TITHIS = [2, 5, 8, 11, 14, 15];

/** Observances belonging to the Digambar calendar, not to a Tapagachh year. */
const DIGAMBAR_ONLY = ["das lakshan", "dashlakshan"];

type AnchorSpec = {
  rule: string;
  /** Matched case-insensitively as a substring of title_en. */
  match: string;
  month: ShwetambarMonthKey;
  paksha: "sud" | "vad";
  tithi: number;
};

/**
 * Where the fixed festivals fall in the Jain lunar year.
 *
 * THIS TABLE IS A REVIEW CHECKLIST, NOT AN AUTHORITY. It exists so a
 * transcription slip is caught before publication, and it must itself be signed
 * off by the same named authority who verifies the year. The point of §17.6.1 is
 * precisely that software does not get to assert these dates — a validator that
 * quietly became the source of truth would be the original bug wearing a hat.
 */
const ANCHORS: AnchorSpec[] = [
  { rule: "PV1", match: "samvatsari", month: "bhadarvo", paksha: "sud", tithi: 4 },
  { rule: "PV3", match: "mahavir jayanti", month: "chaitra", paksha: "sud", tithi: 13 },
  { rule: "PV4", match: "jain new year", month: "kartak", paksha: "sud", tithi: 1 },
  { rule: "PV4", match: "diwali", month: "aso", paksha: "vad", tithi: 15 },
  { rule: "PV5", match: "kartik purnima", month: "kartak", paksha: "sud", tithi: 15 },
  { rule: "PV5", match: "akshaya tritiya", month: "vaishakh", paksha: "sud", tithi: 3 },
];

function daysWithEvent(year: PanchangYear, needle: string): PanchangDay[] {
  return year.days.filter((d) =>
    d.events.some((e) => e.title_en.toLowerCase().includes(needle)),
  );
}

function describeDay(day: PanchangDay): string {
  return `${day.date} (${day.month} ${day.paksha} ${day.tithi})`;
}

function dayIndex(year: PanchangYear, day: PanchangDay): number {
  return year.days.findIndex((d) => d.date === day.date);
}

/**
 * Check a transcribed year against the anchors a Tapagachh Panchang must hit.
 *
 * Returns EVERY problem rather than the first: whoever is repairing a
 * transcription wants the whole list, not one upload per error.
 *
 * An empty array is not a claim that the year is correct — only that it does not
 * contradict the handful of things software is entitled to check. Correctness is
 * the verifier's name in `provenance`.
 */
export function panchangAnchorIssues(year: PanchangYear): PanchangAnchorIssue[] {
  const issues: PanchangAnchorIssue[] = [];
  const add = (rule: string, message: string) => issues.push({ rule, message });

  // PV6 — month vocabulary.
  const declared = year.months.map((m) => m.key);
  const unexpected = declared.filter(
    (k) => !(SHWETAMBAR_MONTH_KEYS as readonly string[]).includes(k),
  );
  if (unexpected.length > 0) {
    add(
      "PV6",
      `Month keys are not the Shwetambar set: ${unexpected.join(", ")}. Expected: ${SHWETAMBAR_MONTH_KEYS.join(", ")}.`,
    );
  }
  const missingMonths = SHWETAMBAR_MONTH_KEYS.filter((k) => !declared.includes(k));
  if (missingMonths.length > 0) {
    add("PV6", `Months missing from the year: ${missingMonths.join(", ")}.`);
  }

  // PV1 / PV3 / PV4 / PV5 — fixed festivals land on their tithi. A festival
  // that is absent altogether is PV9's business, not this rule's.
  for (const anchor of ANCHORS) {
    for (const day of daysWithEvent(year, anchor.match)) {
      const right =
        day.month === anchor.month &&
        day.paksha === anchor.paksha &&
        day.tithi === anchor.tithi;
      if (!right) {
        add(
          anchor.rule,
          `"${anchor.match}" is on ${describeDay(day)} but must fall on ${anchor.month} ${anchor.paksha} ${anchor.tithi}.`,
        );
      }
    }
  }

  // PV2 — Paryushan is an eight-day observance ending on Samvatsari, so it
  // begins seven days before it. Measured by POSITION in the day list rather
  // than by tithi arithmetic, because the run may contain a kshay or vridhi day.
  const [samvatsari] = daysWithEvent(year, "samvatsari");
  const [paryushan] = daysWithEvent(year, "paryushan");
  if (samvatsari && paryushan) {
    const gap = dayIndex(year, samvatsari) - dayIndex(year, paryushan);
    if (gap !== 7) {
      add(
        "PV2",
        `Paryushan starts on ${describeDay(paryushan)} and Samvatsari is on ${describeDay(samvatsari)} — ${gap} days apart, expected 7.`,
      );
    }
  }

  // PV7 — sect purity.
  if (year.sect.toLowerCase() === "shwetambar") {
    for (const day of year.days) {
      for (const event of day.events) {
        const title = event.title_en.toLowerCase();
        if (DIGAMBAR_ONLY.some((d) => title.includes(d))) {
          add(
            "PV7",
            `"${event.title_en}" on ${day.date} is a Digambar observance and does not belong in a Shwetambar year.`,
          );
        }
      }
    }
  }

  // PV8 — parv tithis carry the marker families look for.
  const unmarked = year.days.filter((d) => PARV_TITHIS.includes(d.tithi) && !d.parvTithi);
  if (unmarked.length > 0) {
    add(
      "PV8",
      `${unmarked.length} parv day(s) are not marked parvTithi, starting ${describeDay(unmarked[0]!)}. Parv tithis are ${PARV_TITHIS.join(", ")}.`,
    );
  }

  // PV9 — a transcribed year is not nine events.
  const eventCount = year.days.reduce((n, d) => n + d.events.length, 0);
  if (eventCount < 16) {
    add(
      "PV9",
      `Only ${eventCount} events in the year; a transcribed Panchang carries at least 16.`,
    );
  }
  if (!year.days.some((d) => d.events.some((e) => e.type === "kalyanak"))) {
    add(
      "PV9",
      "No kalyanak events at all — the Panch Kalyanak of the Tirthankars are missing.",
    );
  }

  return issues;
}

/** Shape anchor issues for the API envelope's `details` array. */
export function panchangAnchorDetails(
  issues: PanchangAnchorIssue[],
): Array<{ path: string; message: string }> {
  return issues.map((i) => ({ path: i.rule, message: i.message }));
}
