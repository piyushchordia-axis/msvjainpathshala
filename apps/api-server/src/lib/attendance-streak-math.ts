/**
 * AT22 streak arithmetic — pure so PERF #14 can rewrite I/O without changing rules.
 *
 * - present/late count as attended
 * - excused skips (neither continues nor breaks)
 * - absent resets to 0
 * - cancelled / holiday sessions are not in `eligible` (caller filters)
 * - bonus every 4 consecutive attended, repeating; milestone = triggering session_id
 */
export const STREAK_EVERY = 4;

export type StreakEligibleMark = {
  session_id: string;
  status: string;
};

export type StreakComputeResult = {
  streak: number;
  /** Session ids that completed a 4/8/12… milestone (idempotency key includes these). */
  milestoneSessionIds: string[];
};

export function computeAttendanceStreak(eligible: StreakEligibleMark[]): StreakComputeResult {
  let streak = 0;
  const milestoneSessionIds: string[] = [];
  for (const e of eligible) {
    if (e.status === "excused") continue;
    if (e.status === "absent") {
      streak = 0;
      continue;
    }
    if (e.status === "present" || e.status === "late") {
      streak += 1;
      if (streak > 0 && streak % STREAK_EVERY === 0) {
        milestoneSessionIds.push(e.session_id);
      }
    }
  }
  return { streak, milestoneSessionIds };
}

/**
 * Bound for history reads (PERF #14). AT22 only needs the trailing attended run
 * plus enough room for repeating milestones; 60 eligible sessions covers ~15
 * weeks of thrice-weekly Pathshala — longer continuous streaks without an
 * absent are pastoral outliers, and prior milestones already sit in the ledger.
 */
export const STREAK_HISTORY_BOUND = 60;
