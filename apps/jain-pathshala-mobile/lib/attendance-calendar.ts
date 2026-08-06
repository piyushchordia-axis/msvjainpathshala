/**
 * Pure helpers for the parent/student month attendance calendar.
 * AT6: unmarked days stay blank — never inferred absent.
 *
 * Calendar vocabulary is Present / Leave / Holiday only:
 * - present + late → Present (AT3)
 * - excused + parent leave notice → Leave (AT4)
 * - absent → blank (not a calendar marker)
 */

export type AttendanceStatusKind = "present" | "late" | "absent" | "excused";

/** Paint-facing mark: only Present is shown on the grid. */
export type CalendarMarkKind = "present";

export type CalendarDayCell = {
  /** YYYY-MM-DD, or null for leading/trailing pad cells. */
  date: string | null;
  day: number | null;
  markStatus: CalendarMarkKind | null;
  onLeave: boolean;
  isHoliday: boolean;
  holidayReason: string | null;
};

export type MonthListEntry = {
  id: string;
  /** Sort key YYYY-MM-DD */
  date: string;
  kind: "mark" | "leave" | "holiday";
  label: string;
  note: string | null;
  /** Normalized for tones: present for marks, null for leave/holiday. */
  status?: CalendarMarkKind | null;
};

export function currentMonthIst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [yStr, mStr] = month.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthLabel(month: string, hi: boolean): string {
  const [yStr, mStr] = month.split("-");
  const d = new Date(Number(yStr), Number(mStr) - 1, 1);
  return d.toLocaleDateString(hi ? "hi-IN" : "en-IN", { month: "long", year: "numeric" });
}

/** Pill tone for Present / Leave / Holiday list rows. */
export function calendarEventTone(
  kind: MonthListEntry["kind"],
): "success" | "primary" | "neutral" {
  if (kind === "mark") return "success";
  if (kind === "leave") return "primary";
  return "neutral";
}

/**
 * Map a raw attendance status to home/calendar preview vocabulary.
 * Returns null for absent (omit from preview).
 */
export function previewAttendanceLabel(
  status: string,
  hi: boolean,
): { kind: "mark" | "leave"; label: string } | null {
  const s = status.toLowerCase();
  if (s === "present" || s === "late") {
    return { kind: "mark", label: hi ? "उपस्थित" : "Present" };
  }
  if (s === "excused") {
    return { kind: "leave", label: hi ? "अवकाश" : "Leave" };
  }
  return null;
}

function parseStatus(raw: string): AttendanceStatusKind | null {
  const s = raw.toLowerCase();
  if (s === "present" || s === "late" || s === "absent" || s === "excused") return s;
  return null;
}

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function dateInMonth(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** Expand an inclusive leave range to YYYY-MM-DD dates that fall inside `month`. */
export function leaveDatesInMonth(
  month: string,
  startDate: string,
  endDate: string,
): string[] {
  const last = daysInMonth(month);
  const monthStart = `${month}-01`;
  const monthEnd = dateInMonth(month, last);
  const from = startDate < monthStart ? monthStart : startDate;
  const to = endDate > monthEnd ? monthEnd : endDate;
  if (from > to) return [];
  const out: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  const cursor = new Date(Date.UTC(fy, fm - 1, fd));
  const end = new Date(Date.UTC(ty, tm - 1, td));
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function buildMonthDayCells(opts: {
  month: string;
  marks: Array<{ session_date: string; status: string }>;
  leaveRanges: Array<{ start_date: string; end_date: string }>;
  holidays: Array<{ holiday_date: string; reason: string | null }>;
}): CalendarDayCell[] {
  const presentByDate = new Set<string>();
  const excusedByDate = new Set<string>();
  for (const m of opts.marks) {
    const st = parseStatus(m.status);
    if (!st || st === "absent") continue;
    if (st === "present" || st === "late") {
      presentByDate.add(m.session_date);
      excusedByDate.delete(m.session_date);
    } else if (st === "excused" && !presentByDate.has(m.session_date)) {
      excusedByDate.add(m.session_date);
    }
  }

  const leaveSet = new Set<string>();
  for (const r of opts.leaveRanges) {
    for (const d of leaveDatesInMonth(opts.month, r.start_date, r.end_date)) {
      leaveSet.add(d);
    }
  }

  const holidayByDate = new Map<string, string | null>();
  for (const h of opts.holidays) {
    if (h.holiday_date.startsWith(opts.month)) {
      holidayByDate.set(h.holiday_date, h.reason);
    }
  }

  const [y, m] = opts.month.split("-").map(Number) as [number, number];
  // Monday-first: JS getUTCDay Sun=0 → Mon=0.
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const totalDays = daysInMonth(opts.month);
  const cells: CalendarDayCell[] = [];

  for (let i = 0; i < firstDow; i++) {
    cells.push({
      date: null,
      day: null,
      markStatus: null,
      onLeave: false,
      isHoliday: false,
      holidayReason: null,
    });
  }

  for (let day = 1; day <= totalDays; day++) {
    const date = dateInMonth(opts.month, day);
    const markStatus: CalendarMarkKind | null = presentByDate.has(date) ? "present" : null;
    const isHoliday = holidayByDate.has(date);
    // Leave: parent notice or excused mark; suppressed when Present is shown.
    const onLeave = !markStatus && (leaveSet.has(date) || excusedByDate.has(date));
    cells.push({
      date,
      day,
      markStatus,
      onLeave,
      isHoliday,
      holidayReason: isHoliday ? (holidayByDate.get(date) ?? null) : null,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({
      date: null,
      day: null,
      markStatus: null,
      onLeave: false,
      isHoliday: false,
      holidayReason: null,
    });
  }

  return cells;
}

export function buildMonthListEntries(opts: {
  month: string;
  marks: Array<{
    id: string;
    session_date: string;
    status: string;
    topic: string | null;
  }>;
  leaveRanges: Array<{
    id: string;
    start_date: string;
    end_date: string;
    reason: string | null;
  }>;
  holidays: Array<{ id: string; holiday_date: string; reason: string | null }>;
  hi: boolean;
}): MonthListEntry[] {
  const entries: MonthListEntry[] = [];
  const presentLabel = opts.hi ? "उपस्थित" : "Present";
  const leaveLabel = opts.hi ? "अवकाश" : "Leave";

  for (const m of opts.marks) {
    if (!m.session_date.startsWith(opts.month)) continue;
    const st = parseStatus(m.status);
    if (!st || st === "absent") continue;
    if (st === "present" || st === "late") {
      entries.push({
        id: `mark:${m.id}`,
        date: m.session_date,
        kind: "mark",
        label: presentLabel,
        note: m.topic,
        status: "present",
      });
      continue;
    }
    // excused → Leave vocabulary
    entries.push({
      id: `leave:excused:${m.id}`,
      date: m.session_date,
      kind: "leave",
      label: leaveLabel,
      note: m.topic,
    });
  }

  for (const r of opts.leaveRanges) {
    const dates = leaveDatesInMonth(opts.month, r.start_date, r.end_date);
    if (dates.length === 0) continue;
    const rangeNote =
      r.start_date === r.end_date
        ? r.reason
        : [`${r.start_date} → ${r.end_date}`, r.reason].filter(Boolean).join(" · ") || null;
    entries.push({
      id: `leave:${r.id}`,
      date: dates[0]!,
      kind: "leave",
      label: leaveLabel,
      note: rangeNote,
    });
  }

  for (const h of opts.holidays) {
    if (!h.holiday_date.startsWith(opts.month)) continue;
    entries.push({
      id: `holiday:${h.id}`,
      date: h.holiday_date,
      kind: "holiday",
      label: opts.hi ? "छुट्टी" : "Holiday",
      note: h.reason,
    });
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)));
  return entries;
}
