import { describe, expect, it } from "vitest";
import { lastCompletedMonthYmIst } from "../src/jobs/report-jobs";

describe("lastCompletedMonthYmIst", () => {
  it("rolls December from January", () => {
    expect(lastCompletedMonthYmIst("2026-01-01")).toBe("2025-12");
  });

  it("subtracts one month within the year", () => {
    expect(lastCompletedMonthYmIst("2026-08-07")).toBe("2026-07");
  });
});
