/**
 * Client helpers for niyam streak badges / date chips.
 * Ladder + bilingual labels live in @workspace/api-zod (shared with api-server).
 */
import {
  niyamBadgeLabel,
  niyamBadgeLadder,
  type NiyamBadgeMilestone,
} from "@workspace/api-zod";

export type NiyamPeriodType = "daily" | "weekly" | "monthly";
export type BadgeMilestone = NiyamBadgeMilestone;

export function badgeLadder(niyamType: string): BadgeMilestone[] {
  return niyamBadgeLadder(niyamType);
}

/** Mobile screens pass `hi`; map to the shared lang enum. */
export function badgeLabel(key: string, hi: boolean): string {
  return niyamBadgeLabel(key, hi ? "hi" : "en");
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
