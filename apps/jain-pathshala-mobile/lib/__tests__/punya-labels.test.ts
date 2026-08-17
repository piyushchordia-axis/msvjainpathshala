import { describe, expect, it } from "vitest";
import { punyaFeatureLabel } from "@/lib/punya-labels";

describe("punyaFeatureLabel", () => {
  it("returns Devanagari for known keys in Hindi", () => {
    expect(punyaFeatureLabel("attendance_present", true)).toBe("उपस्थिति");
    expect(punyaFeatureLabel("homework_completion", true)).toBe("गृहकार्य");
  });

  it("returns English for known keys", () => {
    expect(punyaFeatureLabel("attendance_present", false)).toBe("Attendance");
    expect(punyaFeatureLabel("manual_award", false)).toBe("Awarded by Guruji");
  });

  it("humanises unknown keys instead of going blank", () => {
    expect(punyaFeatureLabel("new_feature_key", false)).toBe("New Feature Key");
  });
});
