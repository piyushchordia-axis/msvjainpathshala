/**
 * C5 — a corrupt queue payload must never silently read back as "nothing was
 * ever queued". readQueue quarantines the raw bytes under `<key>.corrupt`
 * and logs, instead of swallowing the parse failure and returning [].
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => mem.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: async (k: string) => {
      mem.delete(k);
    },
    multiRemove: async (keys: string[]) => {
      for (const k of keys) mem.delete(k);
    },
  },
}));

import { QUEUE_KEYS } from "../queue-keys";
import { readQueue, writeQueue } from "../storage";

describe("readQueue — corrupt payload quarantine (C5)", () => {
  beforeEach(() => {
    mem.clear();
    vi.restoreAllMocks();
  });

  it("moves a corrupt payload to <key>.corrupt and returns [] rather than discarding it", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const corrupt = '{"not":"valid json"';
    mem.set(QUEUE_KEYS.course_progress, corrupt);

    const result = await readQueue(QUEUE_KEYS.course_progress);

    expect(result).toEqual([]);
    // The original key is cleared so the next read doesn't re-hit the same
    // parse failure forever.
    expect(mem.has(QUEUE_KEYS.course_progress)).toBe(false);
    // The raw bytes survive under the quarantine key for recovery/inspection.
    expect(mem.get(`${QUEUE_KEYS.course_progress}.corrupt`)).toBe(corrupt);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("does not quarantine anything for a normal, valid queue", async () => {
    await writeQueue(QUEUE_KEYS.course_progress, []);
    const result = await readQueue(QUEUE_KEYS.course_progress);
    expect(result).toEqual([]);
    expect(mem.has(`${QUEUE_KEYS.course_progress}.corrupt`)).toBe(false);
  });

  it("does not clobber an earlier quarantine when a different queue is fine", async () => {
    mem.set(`${QUEUE_KEYS.course_progress}.corrupt`, "previous-corrupt-bytes");
    await writeQueue(QUEUE_KEYS.course_certification, []);
    await readQueue(QUEUE_KEYS.course_certification);
    expect(mem.get(`${QUEUE_KEYS.course_progress}.corrupt`)).toBe("previous-corrupt-bytes");
  });
});
