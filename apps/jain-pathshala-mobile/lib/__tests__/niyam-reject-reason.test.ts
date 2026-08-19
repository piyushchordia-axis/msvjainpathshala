import { describe, it, expect } from "vitest";
import {
  NIYAM_REJECT_REASON_MIN,
  isNiyamRejectReasonValid,
  niyamRejectReasonCharCount,
  NIYAM_REJECT_REASON_PRESETS,
} from "@workspace/api-zod";

describe("niyam reject reason (client gate)", () => {
  it("rejects reasons under 20 chars", () => {
    expect(isNiyamRejectReasonValid("too short")).toBe(false);
    expect(isNiyamRejectReasonValid("x".repeat(NIYAM_REJECT_REASON_MIN - 1))).toBe(false);
    expect(niyamRejectReasonCharCount("  short  ")).toBe(5);
  });

  it("accepts reasons at least 20 chars and all presets", () => {
    expect(isNiyamRejectReasonValid("x".repeat(NIYAM_REJECT_REASON_MIN))).toBe(true);
    for (const p of NIYAM_REJECT_REASON_PRESETS) {
      expect(isNiyamRejectReasonValid(p.en)).toBe(true);
      expect(isNiyamRejectReasonValid(p.hi)).toBe(true);
    }
  });
});
