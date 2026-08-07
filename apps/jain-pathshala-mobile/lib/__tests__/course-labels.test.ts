import { describe, expect, it } from "vitest";
import {
  certifiedFrozenExplanation,
  certifiedLabel,
  courseStatusLabel,
} from "../course-labels";

describe("course-labels (CU11 / CU12 / CU17)", () => {
  it("labels not_started as to be started", () => {
    expect(courseStatusLabel("not_started", false)).toBe("To be started");
    expect(courseStatusLabel("not_started", true)).toBe("शुरू करना बाकी");
  });

  it("uses three-branch honorific and never Guruji for null gender", () => {
    expect(certifiedLabel("male", false)).toContain("Guruji");
    expect(certifiedLabel("female", false)).toContain("Didi");
    expect(certifiedLabel(null, false)).toBe("Certified");
    expect(certifiedLabel(undefined, true)).toBe("प्रमाणित");
    expect(certifiedLabel("other", false)).toBe("Certified");
  });

  it("explains certified freeze (CU12)", () => {
    expect(certifiedFrozenExplanation(false)).toMatch(/certified/i);
    expect(certifiedFrozenExplanation(true).length).toBeGreaterThan(10);
  });
});
