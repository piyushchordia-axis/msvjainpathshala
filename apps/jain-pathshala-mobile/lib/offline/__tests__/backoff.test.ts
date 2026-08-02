import { describe, expect, it } from "vitest";
import { backoffDelayMs, MAX_ATTEMPTS, shouldRetry } from "../backoff";

describe("offline retry backoff", () => {
  it("follows 5s → 15s → 45s → 2min → 5min cap with jitter band", () => {
    const fixed = () => 0.5; // jitter multiplier = 1.0
    expect(backoffDelayMs(1, fixed)).toBe(5_000);
    expect(backoffDelayMs(2, fixed)).toBe(15_000);
    expect(backoffDelayMs(3, fixed)).toBe(45_000);
    expect(backoffDelayMs(4, fixed)).toBe(120_000);
    expect(backoffDelayMs(5, fixed)).toBe(300_000);
    expect(backoffDelayMs(10, fixed)).toBe(300_000);
  });

  it("applies jitter so devices do not reconnect in lockstep", () => {
    const low = backoffDelayMs(1, () => 0); // 0.5×
    const high = backoffDelayMs(1, () => 0.999); // ~1.5×
    expect(low).toBe(2_500);
    expect(high).toBeGreaterThan(5_000);
    expect(high).toBeLessThanOrEqual(7_500);
  });

  it("caps auto-retry at 10 attempts; 409 and other 4xx are terminal", () => {
    expect(MAX_ATTEMPTS).toBe(10);
    expect(shouldRetry(10, 500)).toBe(false);
    expect(shouldRetry(3, 409)).toBe(false);
    expect(shouldRetry(3, 422)).toBe(false);
    expect(shouldRetry(3, 500)).toBe(true);
    expect(shouldRetry(3, 429)).toBe(true);
    expect(shouldRetry(3, undefined)).toBe(true);
  });
});
