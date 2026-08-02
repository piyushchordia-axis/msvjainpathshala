/**
 * Airplane-mode survival: enqueue → clear in-memory → reload from storage → still present.
 * Uses an in-memory AsyncStorage stand-in so tests run in Node.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => mem.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      mem.set(k, v);
    },
    multiRemove: async (keys: string[]) => {
      for (const k of keys) mem.delete(k);
    },
  },
}));

import { QUEUE_KEYS } from "../queue-keys";
import { clearAllQueues, enqueueOp, readQueue } from "../storage";
import { ulid } from "../ulid";

describe("queue persistence across relaunch", () => {
  beforeEach(async () => {
    mem.clear();
    await clearAllQueues();
  });

  it("survives process restart (storage reload) with 20 marks", async () => {
    const submission_op_id = ulid();
    const marks = Array.from({ length: 20 }, (_, i) => ({
      student_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      status: "present" as const,
      client_op_id: ulid(),
    }));

    await enqueueOp(QUEUE_KEYS.attendance, {
      submission_op_id,
      payload: {
        submission_op_id,
        batch_id: "11111111-1111-4111-8111-111111111111",
        session_date: "2026-08-02",
        marks,
        marked_at: new Date().toISOString(),
        client_timestamp: new Date().toISOString(),
      },
      state: "queued",
      attempts: 0,
      next_attempt_at: 0,
      created_at: new Date().toISOString(),
    });

    // Simulate kill + relaunch: only durable storage remains.
    const reloaded = await readQueue(QUEUE_KEYS.attendance);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]!.submission_op_id).toBe(submission_op_id);
    expect((reloaded[0]!.payload as { marks: unknown[] }).marks).toHaveLength(20);
    // Never carries a client-minted session_id.
    expect(reloaded[0]!.payload).not.toHaveProperty("session_id");
  });
});
