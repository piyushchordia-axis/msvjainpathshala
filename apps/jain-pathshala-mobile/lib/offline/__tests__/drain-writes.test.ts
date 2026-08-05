/**
 * Batch-write drain pass — PERF #23 measurement.
 *
 * BEFORE (updateOp per op in loop):
 *   20 queued attendance ops → 20 AsyncStorage writes (mark syncing)
 *   + up to 40 writes on result handling (updateOp/removeOp per op, some ops double-write)
 *   = 40–60 full-queue JSON serialisations per drain pass.
 *
 * AFTER (read once, mutate in memory, write once per dirty queue):
 *   Same 20 ops → at most 2 writes to jp.queue.attendance (syncing pass + result pass).
 *
 * Spinner worst-case (lib/api.ts REQUEST_TIMEOUT_MS = 30_000):
 *   BEFORE: staleTime 0, retry 3, no cache → ~90s bare spinner offline (30s × 3 attempts).
 *   AFTER:  offlineFirst + persisted roster → 0s on cache hit; miss capped at 60s (retry 2).
 *
 * Full "roster renders offline from cache" needs RN + PersistQueryClientProvider — not runnable
 * in this Node/vitest harness; wiring is covered by lib/query-client.ts + app/_layout.tsx.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QUEUE_KEYS } from "../queue-keys";
import { clearAllQueues, enqueueOp } from "../storage";
import { drainQueues } from "../sync-engine";
import { ulid } from "../ulid";
import type { QueuedOp } from "../types";

const mem = new Map<string, string>();
let setItemCalls = 0;

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => mem.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      setItemCalls += 1;
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

function queuedOp(id: string): QueuedOp {
  return {
    submission_op_id: id,
    payload: {
      submission_op_id: id,
      batch_id: "11111111-1111-4111-8111-111111111111",
      session_date: "2026-08-02",
      marks: [
        {
          student_id: "00000000-0000-4000-8000-000000000001",
          status: "present" as const,
          client_op_id: ulid(),
        },
      ],
      marked_at: new Date().toISOString(),
      client_timestamp: new Date().toISOString(),
    },
    state: "queued",
    attempts: 0,
    next_attempt_at: 0,
    created_at: new Date().toISOString(),
  };
}

describe("drainQueues batch writes", () => {
  beforeEach(async () => {
    mem.clear();
    setItemCalls = 0;
    apiPost.mockReset();
    await clearAllQueues();
  });

  it("draining 20 ops writes the attendance queue at most twice", async () => {
    const opIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const id = ulid();
      opIds.push(id);
      await enqueueOp(QUEUE_KEYS.attendance, queuedOp(id));
    }

    setItemCalls = 0;

    apiPost.mockResolvedValue({
      results: opIds.map((id) => ({
        submission_op_id: id,
        status: "success" as const,
      })),
    });

    await drainQueues();

    // AFTER: 2 writes (syncing + dequeue). BEFORE would have been ≥40.
    expect(setItemCalls).toBeLessThanOrEqual(2);
    expect(setItemCalls).toBe(2);
  });

  it("transport failure still writes at most twice per queue", async () => {
    const opIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const id = ulid();
      opIds.push(id);
      await enqueueOp(QUEUE_KEYS.attendance, queuedOp(id));
    }

    setItemCalls = 0;
    apiPost.mockRejectedValue(new Error("offline"));

    await drainQueues();

    expect(setItemCalls).toBeLessThanOrEqual(2);
    expect(setItemCalls).toBe(2);
  });
});
