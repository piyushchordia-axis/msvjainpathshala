/**
 * How a Pachchakkhan time is DISPLAYED, as distinct from how it is computed.
 *
 * The six formulas were already exact and are pinned to the millisecond in
 * pachchakkhan.test.ts. The defect was one layer later: rendering truncated the
 * seconds, so a permission time at 06:48:59 was shown as "6:48 am" — up to 59
 * seconds before the vow actually permits eating. Somebody watching the clock
 * and acting on the displayed minute breaks the vow on the app's word.
 */
import { describe, expect, it } from "vitest";
import { derivePachchakkhan } from "@/lib/panchang/pachchakkhan";
import { formatTimeIst, localHHmmToMs } from "@/lib/panchang/solar";

const AT_0648 = localHHmmToMs("2026-08-12", "06:48")!;
const AT_0649 = localHHmmToMs("2026-08-12", "06:49")!;

describe("formatTimeIst rounding", () => {
  it("rounds a permission time UP to the next whole minute", () => {
    // The reported case. Erring late costs a short wait; erring early breaks
    // the vow, so the asymmetry is deliberate.
    expect(formatTimeIst(AT_0648 + 59_000, false, "up")).toBe(
      formatTimeIst(AT_0649, false, "down"),
    );
    expect(formatTimeIst(AT_0648 + 59_000, false, "up")).toContain("6:49");
  });

  it("rounds a deadline DOWN, for the same reason in the other direction", () => {
    // Chovihar at 19:00:59 must not advertise 19:01.
    expect(formatTimeIst(AT_0648 + 59_000, false, "down")).toContain("6:48");
  });

  it("leaves an exact minute alone in both directions", () => {
    expect(formatTimeIst(AT_0648, false, "up")).toBe(formatTimeIst(AT_0648, false, "down"));
  });

  it("floors by default, so the sunrise/sunset line agrees with Chovihar", () => {
    expect(formatTimeIst(AT_0648 + 59_000, false)).toBe(
      formatTimeIst(AT_0648 + 59_000, false, "down"),
    );
  });

  it("rounds the same way in Hindi", () => {
    expect(formatTimeIst(AT_0648 + 59_000, true, "up")).toBe(
      formatTimeIst(AT_0649, true, "down"),
    );
  });

  it("never rounds a time into the wrong hour", () => {
    const almostNoon = localHHmmToMs("2026-08-12", "11:59")!;
    expect(formatTimeIst(almostNoon + 59_000, false, "up")).toContain("12:00");
  });
});

describe("slot boundaries", () => {
  const slots = derivePachchakkhan(AT_0648, AT_0648 + 8 * 60 * 60_000);

  it("marks the five permission times as starts and Chovihar as the deadline", () => {
    // The renderer reads this rather than deciding per row, so a sixth slot
    // added later cannot silently inherit the wrong rounding.
    expect(
      Object.fromEntries(slots.map((s) => [s.key, s.boundary])),
    ).toEqual({
      navkarsi: "start",
      porsi: "start",
      sadh_porsi: "start",
      purimuddh: "start",
      avaddh: "start",
      chovihar: "deadline",
    });
  });

  it("keeps atMs exact — rounding belongs to display only", () => {
    // If the slot itself were rounded, "is it Porsi yet" would be wrong by up
    // to a minute everywhere, not just in the one label.
    const odd = derivePachchakkhan(AT_0648 + 37_123, AT_0648 + 37_123 + 8 * 60 * 60_000);
    expect(odd[0]!.atMs).toBe(AT_0648 + 37_123 + 48 * 60_000);
  });
});
