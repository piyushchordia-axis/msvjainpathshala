/**
 * Pure helpers for Panchang month grid + day labels.
 */
import type {
  PanchangDay,
  PanchangMonthMeta,
  PanchangPaksha,
  PanchangYear,
} from "@/lib/panchang/schema";
import { formatMonthLabel, shiftMonth } from "@/lib/attendance-calendar";

export { formatMonthLabel, shiftMonth };

export type PanchangDayCell = {
  date: string | null;
  day: number | null;
  /** Parv / Ashtami / Chaudas / Purnima-Amavasya style day. */
  hasParv: boolean;
  /** Any event with highlight=true. */
  hasHighlight: boolean;
  isToday: boolean;
  /** Day payload when present in the year file. */
  panchangDay: PanchangDay | null;
};

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function indexDaysByDate(year: PanchangYear): Map<string, PanchangDay> {
  const map = new Map<string, PanchangDay>();
  for (const d of year.days) map.set(d.date, d);
  return map;
}

export function buildPanchangMonthCells(opts: {
  month: string; // YYYY-MM
  dayByDate: Map<string, PanchangDay>;
  todayIso: string;
}): PanchangDayCell[] {
  const [y, m] = opts.month.split("-").map(Number) as [number, number];
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Mon=0
  const totalDays = daysInMonth(opts.month);
  const cells: PanchangDayCell[] = [];

  for (let i = 0; i < firstDow; i++) {
    cells.push({
      date: null,
      day: null,
      hasParv: false,
      hasHighlight: false,
      isToday: false,
      panchangDay: null,
    });
  }

  for (let day = 1; day <= totalDays; day++) {
    const date = `${opts.month}-${String(day).padStart(2, "0")}`;
    const pd = opts.dayByDate.get(date) ?? null;
    const hasHighlight = !!(pd?.events.some((e) => e.highlight));
    cells.push({
      date,
      day,
      hasParv: !!pd?.parvTithi,
      hasHighlight,
      isToday: date === opts.todayIso,
      panchangDay: pd,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({
      date: null,
      day: null,
      hasParv: false,
      hasHighlight: false,
      isToday: false,
      panchangDay: null,
    });
  }
  return cells;
}

export function pakshaLabel(paksha: PanchangPaksha, hi: boolean): string {
  if (paksha === "sud") return hi ? "सुद" : "Sud";
  return hi ? "वद" : "Vad";
}

export function monthName(
  months: PanchangMonthMeta[],
  key: string,
  hi: boolean,
): string {
  const m = months.find((x) => x.key === key);
  if (!m) return key;
  if (hi) return m.name_hi || m.name_en;
  return m.name_en || m.name_hi;
}

/** e.g. "Shravan Sud 5" / "श्रावण सुद ५" */
export function formatJainDateLine(
  day: PanchangDay,
  months: PanchangMonthMeta[],
  hi: boolean,
): string {
  const name = monthName(months, day.month, hi);
  const pak = pakshaLabel(day.paksha, hi);
  const adhik = day.isAdhikMaas
    ? hi
      ? "अधिक "
      : "Adhik "
    : "";
  const vridhi =
    day.tithiStatus === "vridhi" ? (hi ? " (वृद्धि)" : " (Vridhi)") : "";
  return `${adhik}${name} ${pak} ${day.tithi}${vridhi}`;
}

export function vaarLabel(vaar: string, hi: boolean): string {
  const map: Record<string, string> = {
    Sunday: "रविवार",
    Monday: "सोमवार",
    Tuesday: "मंगलवार",
    Wednesday: "बुधवार",
    Thursday: "गुरुवार",
    Friday: "शुक्रवार",
    Saturday: "शनिवार",
  };
  if (hi) return map[vaar] ?? vaar;
  return vaar;
}

/**
 * Assert vridhi days keep the same tithi as the previous calendar day
 * (when both exist). Used in tests — not required at runtime.
 */
export function isValidVridhiPair(
  prev: PanchangDay | undefined,
  curr: PanchangDay,
): boolean {
  if (curr.tithiStatus !== "vridhi") return true;
  if (!prev) return true;
  return prev.tithi === curr.tithi && prev.paksha === curr.paksha;
}

/**
 * Short cell label for a tithi — "स 5" / "S 5", "व 14" / "V 14".
 *
 * The month grid showed only the Gregorian day number and up to two dots, so
 * finding Ashtami meant opening up to thirty days one at a time. For a Panchang
 * the tithi at a glance IS the product. The data was on the cell all along:
 * PanchangDayCell carries the whole PanchangDay.
 *
 * Paksha is prefixed rather than colour-coded — Sud 5 and Vad 5 are different
 * days and the difference must survive a monochrome screen.
 */
export function tithiCellLabel(day: PanchangDay, hi: boolean): string {
  const paksha = day.paksha === "sud" ? (hi ? "स" : "S") : hi ? "व" : "V";
  return `${paksha} ${day.tithi}`;
}

/**
 * The Jain month(s) a Gregorian month spans, e.g. "Shravan–Bhadarvo".
 *
 * A Gregorian month almost always straddles two Jain months, and the header
 * named neither — so an adhik maas was invisible until a day was opened, which
 * is exactly the month a reader most needs warning about.
 */
export function jainMonthSpan(
  cells: PanchangDayCell[],
  months: PanchangMonthMeta[],
  hi: boolean,
): string | null {
  const seen: string[] = [];
  for (const cell of cells) {
    const day = cell.panchangDay;
    if (!day) continue;
    const label = (day.isAdhikMaas ? (hi ? "अधिक " : "Adhik ") : "") + monthName(months, day.month, hi);
    if (!seen.includes(label)) seen.push(label);
  }
  if (seen.length === 0) return null;
  return seen.join("–");
}
