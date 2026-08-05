/**
 * AT22 streak rules — must pass against current arithmetic BEFORE PERF #14 I/O rewrite.
 */
import { describe, expect, it } from "vitest";
import {
  computeAttendanceStreak,
  STREAK_EVERY,
} from "../src/lib/attendance-streak-math";

describe("AT22 attendance streak arithmetic", () => {
  it("present and late count; bonus every 4 repeating", () => {
    const marks = [
      { session_id: "s1", status: "present" },
      { session_id: "s2", status: "late" },
      { session_id: "s3", status: "present" },
      { session_id: "s4", status: "present" },
      { session_id: "s5", status: "present" },
      { session_id: "s6", status: "present" },
      { session_id: "s7", status: "present" },
      { session_id: "s8", status: "late" },
    ];
    const r = computeAttendanceStreak(marks);
    expect(r.streak).toBe(8);
    expect(r.milestoneSessionIds).toEqual(["s4", "s8"]);
    expect(STREAK_EVERY).toBe(4);
  });

  it("excused skips without breaking the streak", () => {
    const r = computeAttendanceStreak([
      { session_id: "s1", status: "present" },
      { session_id: "s2", status: "present" },
      { session_id: "s3", status: "excused" },
      { session_id: "s4", status: "present" },
      { session_id: "s5", status: "present" },
    ]);
    expect(r.streak).toBe(4);
    expect(r.milestoneSessionIds).toEqual(["s5"]);
  });

  it("absent resets to 0", () => {
    const r = computeAttendanceStreak([
      { session_id: "s1", status: "present" },
      { session_id: "s2", status: "present" },
      { session_id: "s3", status: "present" },
      { session_id: "s4", status: "absent" },
      { session_id: "s5", status: "present" },
    ]);
    expect(r.streak).toBe(1);
    expect(r.milestoneSessionIds).toEqual([]);
  });

  it("idempotency key session is the triggering milestone session", () => {
    const r = computeAttendanceStreak([
      { session_id: "a", status: "present" },
      { session_id: "b", status: "present" },
      { session_id: "c", status: "present" },
      { session_id: "trigger", status: "present" },
    ]);
    expect(r.milestoneSessionIds).toEqual(["trigger"]);
  });
});
