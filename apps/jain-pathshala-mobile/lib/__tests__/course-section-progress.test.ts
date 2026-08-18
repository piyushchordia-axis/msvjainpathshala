/**
 * The subsection screen's progress header — the facts it states about a section.
 *
 * The screen used to show none of this even though every field was already in
 * the cached course tree, which is what made it read as empty.
 */
import { describe, expect, it } from "vitest";
import {
  descriptionPreview,
  sectionProgressSummary,
  type SectionProgressInput,
} from "@/lib/course-labels";

function section(over: Partial<SectionProgressInput> = {}): SectionProgressInput {
  return {
    derived_leaf_total: 8,
    derived_leaf_reached: 3,
    derived_coverage: 0.375,
    punya_points: 40,
    certified_at: null,
    certified_by_gender: null,
    ...over,
  };
}

describe("sectionProgressSummary", () => {
  it("states the count, the percent and the points", () => {
    const s = sectionProgressSummary(section(), false);
    expect(s.countLine).toBe("3 of 8 done");
    expect(s.percentLabel).toBe("38%");
    expect(s.punyaLine).toBe("40 Punya");
    expect(s.certifiedLine).toBeNull();
  });

  it("reads the same facts in Hindi", () => {
    const s = sectionProgressSummary(section(), true);
    expect(s.countLine).toBe("8 में से 3 पूर्ण");
    expect(s.punyaLine).toBe("40 पुण्य");
  });

  it("handles a section nobody has started", () => {
    const s = sectionProgressSummary(
      section({ derived_leaf_reached: 0, derived_coverage: 0 }),
      false,
    );
    expect(s.countLine).toBe("0 of 8 done");
    expect(s.fraction).toBe(0);
    expect(s.percentLabel).toBe("0%");
  });

  it("handles a finished section", () => {
    const s = sectionProgressSummary(
      section({ derived_leaf_reached: 8, derived_coverage: 1 }),
      false,
    );
    expect(s.countLine).toBe("8 of 8 done");
    expect(s.percentLabel).toBe("100%");
  });

  it("falls back to reached/total when coverage is null", () => {
    // A bar is still honest here — the counts say the same thing.
    const s = sectionProgressSummary(section({ derived_coverage: null }), false);
    expect(s.fraction).toBeCloseTo(3 / 8);
    expect(s.percentLabel).toBe("38%");
  });

  it("has no bar at all when there is nothing to count", () => {
    const s = sectionProgressSummary(
      section({ derived_leaf_total: 0, derived_leaf_reached: 0, derived_coverage: null }),
      false,
    );
    expect(s.countLine).toBeNull();
    expect(s.fraction).toBeNull();
    expect(s.percentLabel).toBeNull();
  });

  it("clamps a coverage outside 0..1 rather than overflowing the track", () => {
    expect(sectionProgressSummary(section({ derived_coverage: 1.4 }), false).fraction).toBe(1);
    expect(sectionProgressSummary(section({ derived_coverage: -0.2 }), false).fraction).toBe(0);
  });

  it("omits zero Punya instead of advertising it", () => {
    expect(sectionProgressSummary(section({ punya_points: 0 }), false).punyaLine).toBeNull();
  });

  it("names the certifier by gender (CU17), never defaulting to Guruji", () => {
    expect(
      sectionProgressSummary(
        section({ certified_at: "2026-08-01T00:00:00Z", certified_by_gender: "female" }),
        false,
      ).certifiedLine,
    ).toBe("Certified by Didi");
    expect(
      sectionProgressSummary(
        section({ certified_at: "2026-08-01T00:00:00Z", certified_by_gender: null }),
        false,
      ).certifiedLine,
    ).toBe("Certified");
  });
});

describe("descriptionPreview", () => {
  it("collapses whitespace onto one line", () => {
    expect(descriptionPreview("The first  verse,\n recited before all else.", null, false)).toBe(
      "The first verse, recited before all else.",
    );
  });

  it("truncates with an ellipsis at the cap", () => {
    const long = "a".repeat(200);
    const out = descriptionPreview(long, null, false, 40)!;
    expect(out).toHaveLength(40);
    expect(out.endsWith("…")).toBe(true);
  });

  it("falls back to the other language rather than showing a blank row", () => {
    expect(descriptionPreview(null, "पहला श्लोक", false)).toBe("पहला श्लोक");
    expect(descriptionPreview("The first verse", null, true)).toBe("The first verse");
  });

  it("prefers the reader's language when both exist", () => {
    expect(descriptionPreview("English", "हिन्दी", true)).toBe("हिन्दी");
    expect(descriptionPreview("English", "हिन्दी", false)).toBe("English");
  });

  it("returns null for nothing to show, so the row renders no caption", () => {
    expect(descriptionPreview(null, null, false)).toBeNull();
    expect(descriptionPreview("   ", "", false)).toBeNull();
  });
});
