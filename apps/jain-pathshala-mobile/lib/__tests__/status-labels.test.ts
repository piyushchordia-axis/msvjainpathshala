import { describe, expect, it } from "vitest";
import {
  joinKindLabel,
  recordStatusLabel,
  sessionStatusLabel,
  attendanceStatusLabel,
} from "@/lib/status-labels";

describe("status labels", () => {
  it("localises join kinds", () => {
    expect(joinKindLabel("student", true)).toBe("विद्यार्थी");
    expect(joinKindLabel("shikshak", false)).toBe("Guruji");
  });

  it("localises record and session statuses", () => {
    expect(recordStatusLabel("pending", true)).toBe("लंबित");
    expect(recordStatusLabel("in_progress", false)).toBe("In Progress");
    expect(sessionStatusLabel("in_progress", true)).toBe("चल रहा है");
  });

  it("localises AT1 attendance statuses", () => {
    expect(attendanceStatusLabel("late", true)).toBe("विलंब");
    expect(attendanceStatusLabel("excused", false)).toBe("Excused");
  });
});
