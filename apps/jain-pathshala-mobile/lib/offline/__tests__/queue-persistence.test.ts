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

vi.mock("@react-native-community/netinfo", () => ({
  default: {
    addEventListener: () => () => {},
  },
}));

vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: () => {} }),
  },
}));

const apiPost = vi.fn();
vi.mock("@/lib/api", () => ({
  apiPost: (...args: unknown[]) => apiPost(...args),
}));

import { QUEUE_KEYS } from "../queue-keys";
import { clearAllQueues, enqueueOp, readQueue, writeQueue } from "../storage";
import { drainQueues } from "../sync-engine";
import { ulid } from "../ulid";

describe("queue persistence across relaunch", () => {
  beforeEach(async () => {
    mem.clear();
    apiPost.mockReset();
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

  it("course_certification mid-drain (syncing) survives kill — no lost, no duplicated ops", async () => {
    const submission_op_id = ulid();
    const student_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const node_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    await enqueueOp(QUEUE_KEYS.course_certification, {
      submission_op_id,
      payload: {
        submission_op_id,
        node_kind: "section",
        node_id,
        student_id,
        client_op_id: ulid(),
        certified_at: new Date().toISOString(),
        client_timestamp: new Date().toISOString(),
      },
      state: "queued",
      attempts: 0,
      next_attempt_at: 0,
      created_at: new Date().toISOString(),
    });

    // Drain marked it syncing, then the app was killed before the response landed.
    const mid = await readQueue(QUEUE_KEYS.course_certification);
    expect(mid).toHaveLength(1);
    mid[0] = { ...mid[0]!, state: "syncing", attempts: 1 };
    await writeQueue(QUEUE_KEYS.course_certification, mid);

    // Relaunch — durable storage still has exactly one op.
    const reloaded = await readQueue(QUEUE_KEYS.course_certification);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]!.submission_op_id).toBe(submission_op_id);

    apiPost.mockResolvedValue({
      results: [{ submission_op_id, status: "success", server_id: node_id }],
    });

    // Next drain re-queues orphaned syncing and sends once.
    await drainQueues();
    expect(apiPost).toHaveBeenCalledTimes(1);
    const body = apiPost.mock.calls[0]![1] as {
      ops: Array<{ submission_op_id: string; op_type: string }>;
    };
    expect(body.ops).toHaveLength(1);
    expect(body.ops[0]!.submission_op_id).toBe(submission_op_id);
    expect(body.ops[0]!.op_type).toBe("course_certification");

    const after = await readQueue(QUEUE_KEYS.course_certification);
    expect(after).toHaveLength(0);
  });
});
