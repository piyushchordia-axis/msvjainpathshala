import { describe, expect, it } from "vitest";
import {
  buildMonthDayCells,
  buildMonthListEntries,
  leaveDatesInMonth,
  previewAttendanceLabel,
} from "../attendance-calendar";

describe("attendance-calendar day merge", () => {
  it("expands leave ranges clipped to the month", () => {
    expect(leaveDatesInMonth("2024-03", "2024-02-28", "2024-03-02")).toEqual([
      "2024-03-01",
      "2024-03-02",
    ]);
  });

  it("keeps unmarked days blank (AT6) and prefers present over leave", () => {
    const cells = buildMonthDayCells({
      month: "2024-03",
      marks: [{ session_date: "2024-03-05", status: "present" }],
      leaveRanges: [{ start_date: "2024-03-05", end_date: "2024-03-06" }],
      holidays: [{ holiday_date: "2024-03-10", reason: "Holi" }],
    });

    const day5 = cells.find((c) => c.date === "2024-03-05");
    expect(day5?.markStatus).toBe("present");
    expect(day5?.onLeave).toBe(false);
    expect(day5?.isHoliday).toBe(false);

    const day6 = cells.find((c) => c.date === "2024-03-06");
    expect(day6?.markStatus).toBeNull();
    expect(day6?.onLeave).toBe(true);

    const day7 = cells.find((c) => c.date === "2024-03-07");
    expect(day7?.markStatus).toBeNull();
    expect(day7?.onLeave).toBe(false);
    expect(day7?.isHoliday).toBe(false);

    const day10 = cells.find((c) => c.date === "2024-03-10");
    expect(day10?.isHoliday).toBe(true);
    expect(day10?.holidayReason).toBe("Holi");
  });

  it("maps late → Present and keeps holiday + present together", () => {
    const cells = buildMonthDayCells({
      month: "2024-03",
      marks: [{ session_date: "2024-03-10", status: "late" }],
      leaveRanges: [],
      holidays: [{ holiday_date: "2024-03-10", reason: "Holi" }],
    });
    const day = cells.find((c) => c.date === "2024-03-10");
    expect(day?.markStatus).toBe("present");
    expect(day?.isHoliday).toBe(true);
  });

  it("maps excused → Leave and leaves absent blank", () => {
    const cells = buildMonthDayCells({
      month: "2024-03",
      marks: [
        { session_date: "2024-03-08", status: "excused" },
        { session_date: "2024-03-09", status: "absent" },
      ],
      leaveRanges: [],
      holidays: [],
    });
    const excused = cells.find((c) => c.date === "2024-03-08");
    expect(excused?.markStatus).toBeNull();
    expect(excused?.onLeave).toBe(true);

    const absent = cells.find((c) => c.date === "2024-03-09");
    expect(absent?.markStatus).toBeNull();
    expect(absent?.onLeave).toBe(false);
  });
});

describe("attendance-calendar month list", () => {
  it("labels present/late as Present, excused as Leave, skips absent", () => {
    const entries = buildMonthListEntries({
      month: "2024-03",
      marks: [
        { id: "1", session_date: "2024-03-01", status: "present", topic: "Lesson" },
        { id: "2", session_date: "2024-03-02", status: "late", topic: null },
        { id: "3", session_date: "2024-03-03", status: "excused", topic: null },
        { id: "4", session_date: "2024-03-04", status: "absent", topic: null },
      ],
      leaveRanges: [{ id: "L1", start_date: "2024-03-05", end_date: "2024-03-05", reason: "Travel" }],
      holidays: [{ id: "H1", holiday_date: "2024-03-10", reason: "Holi" }],
      hi: false,
    });

    expect(entries.map((e) => ({ kind: e.kind, label: e.label, date: e.date }))).toEqual([
      { kind: "mark", label: "Present", date: "2024-03-01" },
      { kind: "mark", label: "Present", date: "2024-03-02" },
      { kind: "leave", label: "Leave", date: "2024-03-03" },
      { kind: "leave", label: "Leave", date: "2024-03-05" },
      { kind: "holiday", label: "Holiday", date: "2024-03-10" },
    ]);
  });
});

describe("previewAttendanceLabel", () => {
  it("maps late → Present, excused → Leave, absent → null", () => {
    expect(previewAttendanceLabel("late", false)).toEqual({ kind: "mark", label: "Present" });
    expect(previewAttendanceLabel("excused", false)).toEqual({ kind: "leave", label: "Leave" });
    expect(previewAttendanceLabel("absent", false)).toBeNull();
  });
});
