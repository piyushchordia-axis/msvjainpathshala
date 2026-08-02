/**
 * Niyam submission period keys — Asia/Kolkata calendar boundaries.
 *
 * daily   → YYYY-MM-DD
 * weekly  → YYYY-Www (ISO week, Monday–Sunday, of the given IST date)
 * monthly → YYYY-MM
 */
export type NiyamPeriodType = "daily" | "weekly" | "monthly";

/**
 * Parents may submit for today or yesterday (IST) only — late evening catch-up
 * across midnight, not arbitrary historical backfill. Enforced on submission_date.
 */
export const SUBMISSION_BACKDATE_DAYS = 1;

/**
 * Lookback window when rebuilding streaks from historical submissions.
 * Caps `current_streak` for a daily niyam at this many contiguous periods.
 * Sits well beyond the top badge milestone (daily_100) — a deliberate bound
 * on recompute cost, not a product limit. `longest_streak` is protected by
 * max(stored, recomputed) so a capped recompute never lowers a recorded peak.
 */
export const STREAK_RECOMPUTE_LOOKBACK_DAYS = 400;

/** Parse YYYY-MM-DD as a UTC noon Date (avoids DST edge cases; dates are IST calendar). */
function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
}

function formatYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Calendar date in Asia/Kolkata (YYYY-MM-DD). Used for period keys and the
 * submit backdate window — never a fixed +5.5h offset on wall-clock alone.
 */
export function istCalendarDate(when: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
}

/** Subtract `days` from a YYYY-MM-DD calendar date (IST date arithmetic). */
export function addCalendarDays(ymd: string, days: number): string {
  const d = parseYmd(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return formatYmd(d);
}

/** ISO week number (1–53) and ISO week-year for a UTC calendar date. */
function isoWeekParts(d: Date): { year: number; week: number } {
  // Thursday of this week determines the ISO week-year.
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7; // Mon=1 … Sun=7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: tmp.getUTCFullYear(), week };
}

export function periodKey(niyamType: NiyamPeriodType, ymd: string): string {
  if (niyamType === "daily") return ymd;
  if (niyamType === "monthly") return ymd.slice(0, 7);
  const { year, week } = isoWeekParts(parseYmd(ymd));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Previous contiguous period key for streak continuation. */
export function previousPeriodKey(niyamType: NiyamPeriodType, key: string): string {
  if (niyamType === "daily") {
    const d = parseYmd(key);
    d.setUTCDate(d.getUTCDate() - 1);
    return formatYmd(d);
  }
  if (niyamType === "monthly") {
    const [yStr, mStr] = key.split("-");
    let y = Number(yStr);
    let m = Number(mStr) - 1;
    if (m < 1) {
      y -= 1;
      m = 12;
    }
    return `${y}-${String(m).padStart(2, "0")}`;
  }
  // weekly: go to Monday of this ISO week, then subtract 7 days
  const match = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!match) return key;
  const year = Number(match[1]);
  const week = Number(match[2]);
  // Approximate: Jan 4 is always in week 1; find Monday of target week then -7
  const jan4 = new Date(Date.UTC(year, 0, 4, 12, 0, 0));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7 - 7);
  return periodKey("weekly", formatYmd(monday));
}

export function periodLabel(
  niyamType: NiyamPeriodType,
  key: string,
  lang: "en" | "hi" = "en",
): string {
  if (niyamType === "daily") {
    return lang === "hi" ? `दिन ${key}` : `Day ${key}`;
  }
  if (niyamType === "weekly") {
    return lang === "hi" ? `सप्ताह ${key}` : `Week ${key}`;
  }
  return lang === "hi" ? `माह ${key}` : `Month ${key}`;
}

/** Human status tag for catalog UI. */
export function submittedPeriodTag(
  niyamType: NiyamPeriodType,
  lang: "en" | "hi" = "en",
): string {
  if (niyamType === "daily") {
    return lang === "hi" ? "आज प्रस्तुत" : "Submitted today";
  }
  if (niyamType === "weekly") {
    return lang === "hi" ? "इस सप्ताह प्रस्तुत" : "Submitted this week";
  }
  return lang === "hi" ? "इस माह प्रस्तुत" : "Submitted this month";
}

/** Kinds allowed by a proof_type value. */
export function allowedMediaKinds(
  proofType: string,
): Array<"photo" | "video" | "audio"> {
  if (proofType === "photo") return ["photo"];
  if (proofType === "video") return ["video"];
  if (proofType === "audio") return ["audio"];
  if (proofType === "either") return ["photo", "video"];
  // "any" and unknown → all three (matches PROOF_TYPES; no dead fallback).
  return ["photo", "video", "audio"];
}
