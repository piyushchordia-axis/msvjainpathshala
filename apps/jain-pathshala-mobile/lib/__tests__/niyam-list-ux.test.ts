/**
 * The two decisions behind the niyam UX pass: which badge a submission row
 * shows, and which proof sources a niyam offers.
 *
 * Both were flagged from use — the submissions list read as very busy (two
 * coloured pills per row saying one fact), and the proof buttons filled the
 * page. Both rules are pure so they can be checked here; the components
 * themselves reach react-native, which this bundler cannot parse.
 */
import { describe, expect, it } from "vitest";
import { isApprovedStatus, submissionBadge } from "@/lib/niyam-submission-badges";
import {
  proofSourceLabel,
  proofSourceNeedsSheet,
  proofSources,
} from "@/lib/niyam-proof-sources";

describe("submissionBadge", () => {
  it("shows the points for an approved submission, not the status too", () => {
    // The whole point: approved + points said the same thing twice, on every
    // row of a parent's history.
    const badge = submissionBadge({ status: "approved", points_awarded: 5 });
    expect(badge).toEqual({ kind: "points", points: 5 });
  });

  it.each(["approved", "accepted", "auto_approved", "featured"])(
    "treats %s as approved",
    (status) => {
      expect(isApprovedStatus(status)).toBe(true);
      expect(submissionBadge({ status, points_awarded: 3 }).kind).toBe("points");
    },
  );

  it("keeps the status badge for pending and rejected", () => {
    // These are the rows a parent is scanning for; they must stay visible.
    expect(submissionBadge({ status: "pending", points_awarded: null })).toEqual({
      kind: "status",
      status: "pending",
    });
    expect(submissionBadge({ status: "rejected", points_awarded: null })).toEqual({
      kind: "status",
      status: "rejected",
    });
  });

  it("still shows a status when approved but no points were recorded", () => {
    // Otherwise the row would carry no badge at all and read as unreviewed.
    expect(submissionBadge({ status: "approved", points_awarded: null }).kind).toBe("status");
  });

  it("shows zero points as points, not as an absent award", () => {
    // 0 is a real recorded award; `!= null` is deliberate over a truthy check.
    expect(submissionBadge({ status: "approved", points_awarded: 0 })).toEqual({
      kind: "points",
      points: 0,
    });
  });

  it("is case- and whitespace-insensitive about status", () => {
    expect(isApprovedStatus("  Approved ")).toBe(true);
    expect(isApprovedStatus("PENDING")).toBe(false);
  });
});

describe("proofSources", () => {
  it("offers five sources for 'any' — the case that filled the page", () => {
    expect(proofSources("any").map((s) => s.key)).toEqual([
      "photo_camera",
      "photo_library",
      "video_camera",
      "video_library",
      "audio_record",
    ]);
  });

  it("offers four for 'either', which is the column default", () => {
    expect(proofSources("either")).toHaveLength(4);
    // An unrecognised value must behave as the default, not as an empty list —
    // a niyam with no way to attach proof would be unsubmittable.
    expect(proofSources("something_new").map((s) => s.key)).toEqual(
      proofSources("either").map((s) => s.key),
    );
  });

  it("narrows to the allowed kind", () => {
    expect(proofSources("photo").map((s) => s.key)).toEqual([
      "photo_camera",
      "photo_library",
    ]);
    expect(proofSources("video").map((s) => s.key)).toEqual([
      "video_camera",
      "video_library",
    ]);
    expect(proofSources("audio").map((s) => s.key)).toEqual(["audio_record"]);
  });

  it("skips the sheet when there is only one source", () => {
    // A list of one is a tap that buys nothing.
    expect(proofSourceNeedsSheet(proofSources("audio"))).toBe(false);
    expect(proofSourceNeedsSheet(proofSources("photo"))).toBe(true);
    expect(proofSourceNeedsSheet(proofSources("any"))).toBe(true);
  });

  it("labels every source in both languages", () => {
    for (const source of proofSources("any")) {
      expect(proofSourceLabel(source, false).length).toBeGreaterThan(0);
      expect(proofSourceLabel(source, true).length).toBeGreaterThan(0);
      // Hindi must be Devanagari, never transliterated (CLAUDE.md).
      expect(proofSourceLabel(source, true)).toMatch(/[ऀ-ॿ]/);
    }
  });

  it("gives every source a distinct key and icon", () => {
    const all = proofSources("any");
    expect(new Set(all.map((s) => s.key)).size).toBe(all.length);
    expect(new Set(all.map((s) => s.icon)).size).toBe(all.length);
  });
});
