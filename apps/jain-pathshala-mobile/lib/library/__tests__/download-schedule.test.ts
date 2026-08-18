/**
 * SPEC §17.4 / §17.1.3 — PDFs and audio share one download queue, and the PDF
 * button is the audio state machine.
 *
 * The claim worth a test is that the concurrency cap is OVERALL: two separate
 * three-slot queues would let six transfers run at once on a centre's shared
 * wifi, which is precisely what the cap exists to prevent, and nothing in the
 * type system would catch it.
 */
import { describe, expect, it } from "vitest";
import {
  downloadKey,
  pickNextDownloads,
  resolveDownloadButtonState,
  type QueueRow,
} from "@/lib/library/download-schedule";

const row = (itemId: string, status: QueueRow["status"], contentVersion = 1): QueueRow => ({
  itemId,
  status,
  contentVersion,
});

describe("downloadKey", () => {
  it("keeps an item's audio and PDF apart", () => {
    // One item can carry both modalities; a bare item id as the key would make
    // the PDF's progress overwrite the audio's, and cancelling one would cancel
    // the other.
    expect(downloadKey("audio", "i1")).not.toBe(downloadKey("pdf", "i1"));
  });
});

describe("pickNextDownloads", () => {
  it("caps across both kinds, not three of each", () => {
    const picked = pickNextDownloads({
      audio: [row("a1", "queued"), row("a2", "queued")],
      pdf: [row("p1", "queued"), row("p2", "queued")],
      activeKeys: [],
      max: 3,
    });
    expect(picked).toHaveLength(3);
  });

  it("counts running PDFs against an audio download's slot", () => {
    const picked = pickNextDownloads({
      audio: [row("a1", "queued")],
      pdf: [row("p1", "downloading"), row("p2", "downloading"), row("p3", "downloading")],
      activeKeys: [downloadKey("pdf", "p1"), downloadKey("pdf", "p2"), downloadKey("pdf", "p3")],
      max: 3,
    });
    expect(picked).toEqual([]);
  });

  it("clears the small files first — a 60MB granth must not park a slot", () => {
    const picked = pickNextDownloads({
      audio: [row("a1", "queued")],
      pdf: [row("p1", "queued")],
      activeKeys: [],
      max: 1,
    });
    expect(picked).toEqual([{ kind: "audio", itemId: "a1" }]);
  });

  it("never re-picks something already running", () => {
    const picked = pickNextDownloads({
      audio: [row("a1", "queued")],
      pdf: [],
      activeKeys: [downloadKey("audio", "a1")],
      max: 3,
    });
    expect(picked).toEqual([]);
  });

  it("ignores rows that are not waiting", () => {
    const picked = pickNextDownloads({
      audio: [row("a1", "complete"), row("a2", "failed")],
      pdf: [row("p1", "downloading")],
      activeKeys: [downloadKey("pdf", "p1")],
      max: 3,
    });
    // Failed rows wait for an explicit retry — auto-restarting them would loop
    // on a file the server cannot serve.
    expect(picked).toEqual([]);
  });

  it("fills only the free slots", () => {
    const picked = pickNextDownloads({
      audio: [row("a1", "queued"), row("a2", "queued"), row("a3", "queued")],
      pdf: [row("p1", "queued")],
      activeKeys: [downloadKey("pdf", "px")],
      max: 3,
    });
    expect(picked).toHaveLength(2);
  });
});

describe("resolveDownloadButtonState", () => {
  it("is idle with no local record", () => {
    expect(resolveDownloadButtonState(undefined, 1)).toBe("idle");
  });

  it("maps each local status onto its button state", () => {
    expect(resolveDownloadButtonState(row("i", "queued"), 1)).toBe("queued");
    expect(resolveDownloadButtonState(row("i", "downloading"), 1)).toBe("downloading");
    expect(resolveDownloadButtonState(row("i", "failed"), 1)).toBe("failed");
    expect(resolveDownloadButtonState(row("i", "complete"), 1)).toBe("ready");
  });

  it("falls back to idle when the downloaded copy is a superseded version", () => {
    // §17.7 — the reader holds a file, but not the one the library publishes
    // now. Offering "read" would serve the old scan of a corrected granth.
    expect(resolveDownloadButtonState(row("i", "complete", 1), 2)).toBe("idle");
  });
});
