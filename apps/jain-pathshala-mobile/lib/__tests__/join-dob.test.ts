import { describe, it, expect } from "vitest";
import { ageYearsFromDobString, dobProblem, STAFF_SECTIONS, STUDENT_SECTIONS } from "../join";

/** ISO date of birth for someone who turns `age` today, offset by `dayShift`. */
function dobForAge(age: number, dayShift = 0): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate() + dayShift),
  )
    .toISOString()
    .slice(0, 10);
}

describe("join date of birth", () => {
  it("counts whole years, not calendar-year differences", () => {
    expect(ageYearsFromDobString(dobForAge(8))).toBe(8);
    // One day short of the birthday is still 7 — the old age-derived
    // 1-January DOB rounded this up and handed the child their own login.
    expect(ageYearsFromDobString(dobForAge(8, 1))).toBe(7);
    expect(ageYearsFromDobString(dobForAge(35))).toBe(35);
  });

  it("refuses dates that are not real days", () => {
    expect(ageYearsFromDobString("2014-02-31")).toBeNaN();
    expect(ageYearsFromDobString("2014-13-01")).toBeNaN();
    expect(ageYearsFromDobString("14-03-2014")).toBeNaN();
  });

  it("states the problem and the fix for every rejection", () => {
    for (const hi of [false, true]) {
      expect(dobProblem(undefined, 3, 35, hi)).toBeTruthy();
      expect(dobProblem("2014-02-31", 3, 35, hi)).toBeTruthy();
      expect(dobProblem(dobForAge(-1), 3, 35, hi)).toBeTruthy();
      expect(dobProblem(dobForAge(3, 1), 3, 35, hi)).toBeTruthy();
      expect(dobProblem(dobForAge(36, -1), 3, 35, hi)).toBeTruthy();
      // Inside the band, nothing to say.
      expect(dobProblem(dobForAge(3), 3, 35, hi)).toBeNull();
      expect(dobProblem(dobForAge(35), 3, 35, hi)).toBeNull();
    }
  });

  it("collects date of birth in the first section, never age", () => {
    for (const sections of [STUDENT_SECTIONS, STAFF_SECTIONS]) {
      const keys = sections.flatMap((s) => s.keys);
      expect(keys).toContain("date_of_birth");
      expect(keys).not.toContain("age");
    }
  });
});
