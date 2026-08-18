/**
 * Bulk audio upload — the two ways the old panel lied to an admin.
 *
 * It sent every file in one request and, on rejection, marked ALL rows failed,
 * including files the server had already stored. And it matched results back by
 * filename, so two files named the same shared one verdict.
 */
import { describe, expect, it } from "vitest";
import {
  applyOutcome,
  makeRows,
  runBounded,
  setRowProgress,
  type BulkAudioOutcome,
  type BulkAudioRow,
} from "@/lib/bulk-audio-upload";

const stored = (code: string, id: string): BulkAudioOutcome => ({
  kind: "stored",
  itemCode: code,
  itemId: id,
});

describe("applyOutcome", () => {
  it("keeps two identically-named files apart", () => {
    // The old code did `list.find(r => r.filename === row.file.name)`, so both
    // rows took the first result. An admin re-uploading a duplicate saw one
    // success and one phantom.
    let rows = makeRows([{ name: "ST-01.mp3" }, { name: "ST-01.mp3" }]);
    rows = applyOutcome(rows, 0, stored("ST-01", "item-a"));
    rows = applyOutcome(rows, 1, {
      kind: "rejected",
      itemCode: "ST-01",
      error: "No library item matches that item_code.",
    });

    expect(rows[0]).toMatchObject({ status: "done", itemId: "item-a" });
    expect(rows[1]).toMatchObject({ status: "failed", itemId: null });
  });

  it("does NOT un-finish a stored row when a later upload dies", () => {
    // The regression, stated directly.
    let rows = makeRows([{ name: "a.mp3" }, { name: "b.mp3" }, { name: "c.mp3" }]);
    rows = applyOutcome(rows, 0, stored("A", "item-a"));
    rows = applyOutcome(rows, 1, { kind: "unreachable", error: "Network error" });

    expect(rows[0]!.status).toBe("done");
    expect(rows[1]!.status).toBe("unknown");
    expect(rows[2]!.status).toBe("queued");
  });

  it("separates 'the server said no' from 'we never heard back'", () => {
    // Only a server verdict is a failure. A dropped connection leaves the
    // outcome genuinely unknown, and telling an admin it failed invites a
    // duplicate upload of a file that landed.
    let rows = makeRows([{ name: "a.mp3" }, { name: "b.mp3" }]);
    rows = applyOutcome(rows, 0, {
      kind: "rejected",
      itemCode: null,
      error: "Could not parse item_code from filename.",
    });
    rows = applyOutcome(rows, 1, { kind: "unreachable", error: "Network error" });

    expect(rows[0]!.status).toBe("failed");
    expect(rows[1]!.status).toBe("unknown");
  });

  it("carries item_id through so the result can link to the item", () => {
    // item_id was already in the response and thrown away.
    const rows = applyOutcome(makeRows([{ name: "a.mp3" }]), 0, stored("A", "item-a"));
    expect(rows[0]!.itemId).toBe("item-a");
  });
});

describe("setRowProgress", () => {
  it("moves only its own row", () => {
    // Every row used to flip to "uploading" at once, which is what made a
    // forty-file run unreadable.
    const rows = setRowProgress(makeRows([{ name: "a.mp3" }, { name: "b.mp3" }]), 1, 0.4);
    expect(rows[0]!.status).toBe("queued");
    expect(rows[1]).toMatchObject({ status: "uploading", progress: 0.4 });
  });
});

describe("runBounded", () => {
  it("runs every index exactly once", async () => {
    const seen: number[] = [];
    await runBounded(7, 3, async (i) => {
      seen.push(i);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await runBounded(10, 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("finishes the queue even when one item rejects internally", async () => {
    // The runner must not abandon the rest: each row owns its own outcome.
    const done: number[] = [];
    await runBounded(5, 2, async (i) => {
      try {
        if (i === 2) throw new Error("boom");
      } catch {
        /* the caller records the outcome on the row */
      }
      done.push(i);
    });
    expect(done).toHaveLength(5);
  });

  it("handles an empty queue", async () => {
    let calls = 0;
    await runBounded(0, 3, async () => {
      calls++;
    });
    expect(calls).toBe(0);
  });
});

describe("makeRows", () => {
  it("indexes rows so duplicates are addressable", () => {
    const rows: BulkAudioRow[] = makeRows([{ name: "x.mp3" }, { name: "x.mp3" }]);
    expect(rows.map((r) => r.index)).toEqual([0, 1]);
  });
});
