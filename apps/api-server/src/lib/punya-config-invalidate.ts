/**
 * One call to invalidate every cached Punya point value (H19).
 *
 * The config write paths used to clear the attendance and homework caches and
 * nothing else. clearExamPointsCache, clearQuizPointsCache and
 * clearCoursePointsCache were exported and called from nowhere, so editing an
 * exam or quiz value took effect whenever the TTL happened to lapse — and the
 * clears only emptied the in-process Map anyway, so with Redis on, every other
 * instance kept serving the old value for the rest of the TTL.
 *
 * Exists as ONE function on purpose: the previous design required the caller to
 * remember five, and it remembered two.
 */
import { bumpPunyaPointsGeneration } from "./punya-points-cache";
import { clearAttendancePointsCache } from "./attendance-points";
import { clearHomeworkPointsCache } from "./homework-points";
import { clearExamPointsCache } from "./exam-points";
import { clearQuizPointsCache } from "./quiz-points";
import { clearCoursePointsCache } from "./course-points";
import { clearAwardLimitCache } from "./punya-award-limits";
import { clearTierThresholdCache } from "./punya-tiers";

export async function invalidatePunyaPointCaches(): Promise<void> {
  // Cross-instance: every namespaced key becomes unreachable at once.
  await bumpPunyaPointsGeneration();
  // In-process: drop what this instance is holding right now, so the very next
  // read in this request does not serve a value the admin just changed.
  clearAttendancePointsCache();
  clearHomeworkPointsCache();
  clearExamPointsCache();
  clearQuizPointsCache();
  clearCoursePointsCache();
  clearAwardLimitCache();
  clearTierThresholdCache();
}
