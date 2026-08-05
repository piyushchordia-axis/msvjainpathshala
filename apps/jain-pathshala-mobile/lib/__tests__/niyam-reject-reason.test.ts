import { describe, it, expect } from "vitest";
import {
  REJECT_REASON_MIN,
  isRejectReasonValid,
  rejectReasonCharCount,
  REJECT_REASON_PRESETS,
} from "../niyam-reject-reason";

describe("niyam reject reason (client gate)", () => {
  it("rejects reasons under 20 chars", () => {
    expect(isRejectReasonValid("too short")).toBe(false);
    expect(isRejectReasonValid("x".repeat(REJECT_REASON_MIN - 1))).toBe(false);
    expect(rejectReasonCharCount("  short  ")).toBe(5);
  });

  it("accepts reasons at least 20 chars and all presets", () => {
    expect(isRejectReasonValid("x".repeat(REJECT_REASON_MIN))).toBe(true);
    for (const p of REJECT_REASON_PRESETS) {
      expect(isRejectReasonValid(p.en)).toBe(true);
      expect(isRejectReasonValid(p.hi)).toBe(true);
    }
  });
});
