/**
 * C5 — resolveSyncOpOutcome reconciles the true outcome of a drained op.
 *
 * DrainOpResult.status === "failed" on its own conflates a single transport
 * hiccup that is still retrying with a genuinely exhausted op — this is the
 * function queries.ts's course hooks rely on to throw only on a REAL
 * conflict/failure, never on an op that is safely queued for another try.
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
vi.mock("@react-native-community/netinfo", () => ({
  default: { addEventListener: () => () => {} },
}));
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) },
}));
const apiPost = vi.fn();
vi.mock("@/lib/api", () => ({ apiPost: (...args: unknown[]) => apiPost(...args) }));

import { MAX_ATTEMPTS } from "../backoff";
import { QUEUE_KEYS } from "../queue-keys";
import { clearAllQueues, readQueue, writeQueue } from "../storage";
import {
  drainQueues,
  enqueueCourseProgress,
  getRecentDrainResult,
  resolveSyncOpOutcome,
} from "../sync-engine";

const NODE_ID = "11111111-1111-4111-8111-111111111111";
const STUDENT_ID = "22222222-2222-4222-8222-222222222222";

async function enqueueOne() {
  return enqueueCourseProgress({
    node_kind: "section",
    node_id: NODE_ID,
    marks: [{ student_id: STUDENT_ID, status: "completed", client_op_id: "" }],
  });
}

beforeEach(async () => {
  mem.clear();
  apiPost.mockReset();
  await clearAllQueues();
});

describe("resolveSyncOpOutcome", () => {
  it("reports success and lets the op drop from storage", async () => {
    const id = await enqueueOne();
    apiPost.mockResolvedValue({ results: [{ submission_op_id: id, status: "success" }] });
    const results = await drainQueues();

    const outcome = await resolveSyncOpOutcome(QUEUE_KEYS.course_progress, id, results);
    expect(outcome.status).toBe("success");
    expect(await readQueue(QUEUE_KEYS.course_progress)).toHaveLength(0);
  });

  it("reports duplicate, distinct from success", async () => {
    const id = await enqueueOne();
    apiPost.mockResolvedValue({ results: [{ submission_op_id: id, status: "duplicate" }] });
    const results = await drainQueues();

    const outcome = await resolveSyncOpOutcome(QUEUE_KEYS.course_progress, id, results);
    expect(outcome.status).toBe("duplicate");
  });

  it("reports conflict and leaves the op in storage as conflict", async () => {
    const id = await enqueueOne();
    apiPost.mockResolvedValue({
      results: [
        {
          submission_op_id: id,
          status: "conflict",
          error: { code: "ERR_COURSE_NODE_CERTIFIED", message: "Already certified." },
        },
      ],
    });
    const results = await drainQueues();

    const outcome = await resolveSyncOpOutcome(QUEUE_KEYS.course_progress, id, results);
    expect(outcome.status).toBe("conflict");
    expect(outcome.result?.error?.code).toBe("ERR_COURSE_NODE_CERTIFIED");
    const stored = await readQueue(QUEUE_KEYS.course_progress);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.state).toBe("conflict");
  });

  it("reports queued (not failed) when a transport hiccup is still retrying", async () => {
    const id = await enqueueOne();
    apiPost.mockRejectedValue(new Error("network down"));
    const results = await drainQueues();

    // The raw per-attempt result says "failed" — that must NOT be read as
    // terminal on its own; this is exactly the C5 distinction.
    expect(results.find((r) => r.submission_op_id === id)?.status).toBe("failed");

    const outcome = await resolveSyncOpOutcome(QUEUE_KEYS.course_progress, id, results);
    expect(outcome.status).toBe("queued");
    const stored = await readQueue(QUEUE_KEYS.course_progress);
    expect(stored[0]!.state).toBe("queued");
  });

  it("reports failed only once attempts are genuinely exhausted", async () => {
    const id = await enqueueOne();
    // Fast-forward to one attempt short of exhaustion so this drain is the
    // one that tips it over into terminal "failed".
    const seeded = await readQueue(QUEUE_KEYS.course_progress);
    seeded[0] = { ...seeded[0]!, attempts: MAX_ATTEMPTS - 1 };
    await writeQueue(QUEUE_KEYS.course_progress, seeded);

    apiPost.mockRejectedValue(new Error("network down"));
    const results = await drainQueues();

    const outcome = await resolveSyncOpOutcome(QUEUE_KEYS.course_progress, id, results);
    expect(outcome.status).toBe("failed");
    const stored = await readQueue(QUEUE_KEYS.course_progress);
    expect(stored[0]!.state).toBe("failed");
  });

  it("falls back to the recent-result cache when no results array is passed", async () => {
    const id = await enqueueOne();
    apiPost.mockResolvedValue({ results: [{ submission_op_id: id, status: "success" }] });
    await drainQueues();

    // Simulates a poller (useCourseSyncOps) that watched this op get drained
    // by the background loop, not by a call it made itself.
    expect(getRecentDrainResult(id)?.status).toBe("success");
    const outcome = await resolveSyncOpOutcome(QUEUE_KEYS.course_progress, id);
    expect(outcome.status).toBe("success");
  });

  it("carries no `result` payload for an id nothing was ever recorded against", async () => {
    // resolveSyncOpOutcome is only ever asked about an id its own caller just
    // enqueued+drained, so "absent from storage and absent from the cache"
    // does not arise in practice — but it must not fabricate error detail
    // that was never returned by anything.
    const outcome = await resolveSyncOpOutcome(
      QUEUE_KEYS.course_progress,
      "not-a-real-op-id",
    );
    expect(outcome.result).toBeUndefined();
  });
});
