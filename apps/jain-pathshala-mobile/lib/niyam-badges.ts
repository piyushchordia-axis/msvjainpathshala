/** Streak badge ladder (D1) + bilingual labels. Jain term "Niyam" stays untranslated. */

export type NiyamPeriodType = "daily" | "weekly" | "monthly";

export type BadgeMilestone = {
  key: string;
  length: number;
  labelEn: string;
  labelHi: string;
};

const DAILY: BadgeMilestone[] = [
  { key: "daily_7", length: 7, labelEn: "7-day streak", labelHi: "7-दिन की लकीर" },
  { key: "daily_14", length: 14, labelEn: "14-day streak", labelHi: "14-दिन की लकीर" },
  { key: "daily_30", length: 30, labelEn: "30-day streak", labelHi: "30-दिन की लकीर" },
  { key: "daily_60", length: 60, labelEn: "60-day streak", labelHi: "60-दिन की लकीर" },
  { key: "daily_100", length: 100, labelEn: "100-day streak", labelHi: "100-दिन की लकीर" },
];

const WEEKLY: BadgeMilestone[] = [
  { key: "weekly_4", length: 4, labelEn: "4-week streak", labelHi: "4-सप्ताह की लकीर" },
];

const MONTHLY: BadgeMilestone[] = [
  { key: "monthly_3", length: 3, labelEn: "3-month streak", labelHi: "3-माह की लकीर" },
];

export function badgeLadder(niyamType: string): BadgeMilestone[] {
  if (niyamType === "weekly") return WEEKLY;
  if (niyamType === "monthly") return MONTHLY;
  return DAILY;
}

export function badgeLabel(key: string, hi: boolean): string {
  for (const m of [...DAILY, ...WEEKLY, ...MONTHLY]) {
    if (m.key === key) return hi ? m.labelHi : m.labelEn;
  }
  return key;
}

export function nextMilestone(
  niyamType: string,
  currentStreak: number,
): BadgeMilestone | null {
  const ladder = badgeLadder(niyamType);
  return ladder.find((m) => currentStreak < m.length) ?? null;
}

/** Days/periods remaining until the next badge. */
export function moreToNextBadge(
  niyamType: string,
  currentStreak: number,
): { remaining: number; milestone: BadgeMilestone } | null {
  const next = nextMilestone(niyamType, currentStreak);
  if (!next) return null;
  return { remaining: next.length - currentStreak, milestone: next };
}

export function endsInDaysLabel(endDate: string | null | undefined, hi: boolean): string | null {
  if (!endDate) return null;
  const end = new Date(`${endDate}T12:00:00.000Z`);
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const todayStr = ist.toISOString().slice(0, 10);
  const today = new Date(`${todayStr}T12:00:00.000Z`);
  const diff = Math.ceil((end.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diff < 0) return null;
  if (diff === 0) return hi ? "आज समाप्त" : "Ends today";
  return hi ? `${diff} दिन में समाप्त` : `Ends in ${diff} days`;
}

export function dateRangeLabel(
  startDate: string | undefined,
  endDate: string | null | undefined,
  hi: boolean,
): string | null {
  if (!endDate) return null;
  const start = startDate ?? "";
  if (hi) return `${start || "…"} – ${endDate}`;
  return `${start || "…"} – ${endDate}`;
}
