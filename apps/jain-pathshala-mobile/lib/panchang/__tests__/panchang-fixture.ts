/**
 * SYNTHETIC Panchang data, for tests only.
 *
 * READ THIS BEFORE COPYING ANYTHING OUT OF HERE. The tithis below are produced
 * by counting, not by transcription. They are not a Panchang, they are not
 * approximately a Panchang, and they must never reach assets/, the API, or a
 * screen. This is exactly the material that shipped as
 * assets/data/panchang-2026.json and told families Samvatsari was 19 August.
 *
 * It lives here because the calendar helpers (grid alignment, vridhi pairing,
 * kshay gaps) need SOME year-shaped input to be tested against, and a fixture
 * that is obviously fake is safer than one that looks plausible. The provenance
 * block below names itself as a fixture for the same reason.
 */
import {
  SHWETAMBAR_MONTH_KEYS,
  type PanchangDay,
  type PanchangEvent,
  type PanchangYear,
} from "@/lib/panchang/schema";

export const FIXTURE_PROVENANCE = {
  source_publication: "TEST FIXTURE — not a Panchang",
  source_year: "0000",
  transcribed_by: "test",
  verified_by: "test",
  verified_at: "2026-01-01",
};

export const FIXTURE_MONTHS = SHWETAMBAR_MONTH_KEYS.map((key) => ({
  key,
  name_en: key,
  name_hi: key,
  name_gu: null,
  isAdhik: false,
}));

export function makeEvent(over: Partial<PanchangEvent> & { id: string }): PanchangEvent {
  return {
    type: "festival",
    title_en: "Event",
    title_hi: "घटना",
    title_gu: null,
    note_en: null,
    note_hi: null,
    note_gu: null,
    highlight: false,
    linkedItemId: null,
    ...over,
  };
}

export function makeDay(date: string, over: Partial<PanchangDay> = {}): PanchangDay {
  const tithi = over.tithi ?? 1;
  const paksha = over.paksha ?? "sud";
  return {
    date,
    vaar: "Monday",
    month: "kartak",
    isAdhikMaas: false,
    paksha,
    tithi,
    tithiKey: `${paksha}-${tithi}`,
    tithiStatus: "normal",
    nakshatra: "Ashwini",
    parvTithi: [2, 5, 8, 11, 14, 15].includes(tithi),
    events: [],
    ...over,
  };
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * A run of consecutive days with a counted tithi cycle.
 *
 * Counted, and therefore wrong as a Panchang — see the file header. Good enough
 * to exercise grid alignment and the kshay/vridhi helpers, which care about the
 * SHAPE of the sequence and not about which day is which.
 */
export function makeDayRun(startIso: string, count: number): PanchangDay[] {
  const days: PanchangDay[] = [];
  let tithi = 1;
  let paksha: "sud" | "vad" = "sud";
  for (let i = 0; i < count; i++) {
    days.push(makeDay(addDays(startIso, i), { tithi, paksha }));
    tithi += 1;
    if (tithi > 15) {
      tithi = 1;
      paksha = paksha === "sud" ? "vad" : "sud";
    }
  }
  return days;
}

export function makeYear(over: Partial<PanchangYear> = {}): PanchangYear {
  return {
    schemaVersion: 1,
    contentVersion: 1,
    sect: "shwetambar",
    vikramSamvat: 2082,
    veerSamvat: 2552,
    year: 2026,
    provenance: { ...FIXTURE_PROVENANCE },
    months: FIXTURE_MONTHS,
    days: makeDayRun("2026-08-01", 31),
    ...over,
  };
}
