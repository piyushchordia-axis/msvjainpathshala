import { describe, expect, it } from "vitest";
import {
  certifiedFrozenExplanation,
  certifiedLabel,
  courseStatusLabel,
  courseStripTone,
  divergenceNote,
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

  it("maps strip tones (certified overrides status)", () => {
    expect(courseStripTone("not_started", false)).toBe("muted");
    expect(courseStripTone("in_progress", false)).toBe("warningSoft");
    expect(courseStripTone("completed", false)).toBe("successSoft");
    expect(courseStripTone("completed", true)).toBe("accent");
    expect(courseStripTone("not_started", true)).toBe("accent");
  });
});

describe("divergenceNote (C4/CU16)", () => {
  it("says nothing when the section does not diverge", () => {
    expect(
      divergenceNote(
        {
          status: "completed",
          derived_status: "completed",
          derived_leaf_total: 4,
          derived_leaf_reached: 4,
          status_diverges: false,
        },
        false,
      ),
    ).toBeNull();
  });

  it("says nothing when there is no roll-up to compare against (no leaves)", () => {
    expect(
      divergenceNote(
        {
          status: "completed",
          derived_status: null,
          derived_leaf_total: 0,
          derived_leaf_reached: 0,
          status_diverges: true,
        },
        false,
      ),
    ).toBeNull();
  });

  it("states declared vs derived, never auto-correcting either side", () => {
    const note = divergenceNote(
      {
        status: "completed",
        derived_status: "in_progress",
        derived_leaf_total: 8,
        derived_leaf_reached: 3,
        status_diverges: true,
      },
      false,
    );
    expect(note).toContain("Completed");
    expect(note).toContain("In progress");
    expect(note).toContain("3/8");
  });

  it("renders Hindi labels in the hi branch", () => {
    const note = divergenceNote(
      {
        status: "completed",
        derived_status: "in_progress",
        derived_leaf_total: 8,
        derived_leaf_reached: 3,
        status_diverges: true,
      },
      true,
    );
    expect(note).toContain("पूर्ण");
    expect(note).toContain("चल रहा है");
  });
});
