/**
 * C4/C5/H17 — the course progress/certify/bulk mutation logic in queries.ts.
 *
 * These test the plain exported functions (runSetCourseNodeProgress /
 * runCertifyCourseNode / runBulkCourseNodeProgress) that the useXxx hooks
 * wrap, rather than the hooks themselves — the mobile app has no React
 * rendering test harness (see vitest.config.ts), so the mutationFn logic is
 * kept as a standalone, directly-testable async function.
 */
import { existsSync } from "node:fs";
import path from "node:path";
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

const apiGet = vi.fn();
const apiPost = vi.fn();

// vi.mock factories are hoisted above the rest of the file, so the mock
// class must be declared INSIDE the factory rather than referenced from an
// outer const/class (that would throw "Cannot access before initialization").
vi.mock("@/lib/api", () => {
  class MockApiError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode: number,
      public readonly details?: unknown,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return {
    apiGet: (...args: unknown[]) => apiGet(...args),
    apiPost: (...args: unknown[]) => apiPost(...args),
    apiPut: vi.fn(),
    apiPatch: vi.fn(),
    apiDelete: vi.fn(),
    apiGetEnvelope: vi.fn(),
    ApiError: MockApiError,
  };
});

import { clearAllQueues } from "../offline/storage";
import {
  runBulkCourseNodeProgress,
  runCertifyCourseNode,
  runSetCourseNodeProgress,
} from "../queries";

type SyncBatchBody = {
  ops: Array<{
    submission_op_id: string;
    op_type: string;
    payload: { marks?: Array<{ student_id: string }> };
  }>;
};

const NODE_ID = "11111111-1111-4111-8111-111111111111";
const STUDENT_ID = "22222222-2222-4222-8222-222222222222";
const BATCH_ID = "33333333-3333-4333-8333-333333333333";

function successEcho() {
  apiPost.mockImplementation(async (_url: string, body: SyncBatchBody) => ({
    results: body.ops.map((op) => ({ submission_op_id: op.submission_op_id, status: "success" })),
  }));
}

beforeEach(async () => {
  mem.clear();
  apiGet.mockReset();
  apiPost.mockReset();
  await clearAllQueues();
});

describe("runSetCourseNodeProgress (C5)", () => {
  it("throws when the server reports a conflict, so onError actually fires", async () => {
    apiPost.mockImplementation(async (_url: string, body: SyncBatchBody) => ({
      results: [
        {
          submission_op_id: body.ops[0]!.submission_op_id,
          status: "conflict",
          error: { code: "ERR_COURSE_NODE_CERTIFIED", message: "Already certified." },
        },
      ],
    }));

    await expect(
      runSetCourseNodeProgress(
        { nodeId: NODE_ID, nodeKind: "section", student_id: STUDENT_ID, status: "completed" },
        { offline: true },
      ),
    ).rejects.toMatchObject({ code: "ERR_COURSE_NODE_CERTIFIED" });
  });

  it("does NOT throw for a duplicate — it is not an error", async () => {
    apiPost.mockImplementation(async (_url: string, body: SyncBatchBody) => ({
      results: [{ submission_op_id: body.ops[0]!.submission_op_id, status: "duplicate" }],
    }));

    const res = await runSetCourseNodeProgress(
      { nodeId: NODE_ID, nodeKind: "section", student_id: STUDENT_ID, status: "completed" },
      { offline: true },
    );
    expect(res.duplicate).toBe(true);
    expect(res.queued).toBe(false);
  });

  it("does NOT throw when a transport hiccup leaves the op safely queued for retry", async () => {
    apiPost.mockRejectedValue(new Error("network down"));

    const res = await runSetCourseNodeProgress(
      { nodeId: NODE_ID, nodeKind: "section", student_id: STUDENT_ID, status: "completed" },
      { offline: true },
    );
    // The raw drain result said "failed" for this one attempt, but the op is
    // still retrying — that must resolve, not throw (see sync-op-outcome.test.ts).
    expect(res.queued).toBe(true);
  });

  it("resolves normally on success", async () => {
    successEcho();
    const res = await runSetCourseNodeProgress(
      { nodeId: NODE_ID, nodeKind: "section", student_id: STUDENT_ID, status: "completed" },
      { offline: true },
    );
    expect(res.queued).toBe(false);
    expect(res.duplicate).toBeFalsy();
  });
});

describe("runCertifyCourseNode (C5)", () => {
  it("throws when the server reports a conflict", async () => {
    apiPost.mockImplementation(async (_url: string, body: SyncBatchBody) => ({
      results: [
        {
          submission_op_id: body.ops[0]!.submission_op_id,
          status: "conflict",
          error: { code: "ERR_COURSE_NODE_NOT_COMPLETE", message: "Not complete yet." },
        },
      ],
    }));

    await expect(
      runCertifyCourseNode({
        nodeId: NODE_ID,
        nodeKind: "section",
        student_id: STUDENT_ID,
      }),
    ).rejects.toMatchObject({ code: "ERR_COURSE_NODE_NOT_COMPLETE" });
  });
});

describe("runBulkCourseNodeProgress (H17)", () => {
  it("resolves an unspecified roster from the batch and enqueues one op with one mark per student", async () => {
    apiGet.mockResolvedValue({
      items: [
        { id: "s1", full_name: "Asha", student_code: "C1" },
        { id: "s2", full_name: "Bina", student_code: "C2" },
      ],
      next_cursor: null,
    });
    successEcho();

    const res = await runBulkCourseNodeProgress({
      nodeId: NODE_ID,
      batch_id: BATCH_ID,
      status: "completed",
    });

    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(String(apiGet.mock.calls[0]![0])).toContain(`batch_id=${BATCH_ID}`);
    expect(res).toEqual({ applied: 2, skipped: 0, student_ids: ["s1", "s2"] });

    expect(apiPost).toHaveBeenCalledTimes(1);
    const body = apiPost.mock.calls[0]![1] as SyncBatchBody;
    expect(body.ops).toHaveLength(1);
    expect(body.ops[0]!.op_type).toBe("course_progress");
    expect(body.ops[0]!.payload.marks).toHaveLength(2);
  });

  it("skips the roster fetch when student_ids is given explicitly", async () => {
    successEcho();
    const res = await runBulkCourseNodeProgress({
      nodeId: NODE_ID,
      student_ids: ["s9"],
      status: "completed",
    });
    expect(apiGet).not.toHaveBeenCalled();
    expect(res.applied).toBe(1);
  });

  it("routes to the online bulk route when offline is explicitly false", async () => {
    apiPost.mockResolvedValue({ applied: 3, skipped: 1 });
    const res = await runBulkCourseNodeProgress({
      nodeId: NODE_ID,
      batch_id: BATCH_ID,
      status: "completed",
      offline: false,
    });
    expect(apiGet).not.toHaveBeenCalled();
    expect(res).toEqual({ applied: 3, skipped: 1 });
    expect(apiPost).toHaveBeenCalledWith(
      `/v1/courses/nodes/${NODE_ID}/progress/bulk`,
      expect.objectContaining({ batch_id: BATCH_ID, status: "completed" }),
    );
  });

  it("throws ERR_COURSE_ROSTER_UNAVAILABLE rather than silently applying to nobody", async () => {
    apiGet.mockResolvedValue({ items: [], next_cursor: null });
    await expect(
      runBulkCourseNodeProgress({ nodeId: NODE_ID, batch_id: BATCH_ID, status: "completed" }),
    ).rejects.toMatchObject({ code: "ERR_COURSE_ROSTER_UNAVAILABLE" });
  });
});

describe("C4 — the cascade fan-out is gone", () => {
  it("course-progress-cascade.ts no longer exists in the tree", () => {
    const p = path.resolve(process.cwd(), "lib/course-progress-cascade.ts");
    expect(existsSync(p)).toBe(false);
  });

  it("a single section-close write enqueues exactly one op with exactly one mark", async () => {
    successEcho();
    await runSetCourseNodeProgress(
      { nodeId: NODE_ID, nodeKind: "section", student_id: STUDENT_ID, status: "completed" },
      { offline: true },
    );

    // Before C4, closing a section this way also wrote a `completed` row for
    // every uncertified sub-section (course-progress-cascade.ts) — N extra
    // round trips nobody asked for. One call must produce exactly one op.
    expect(apiPost).toHaveBeenCalledTimes(1);
    const body = apiPost.mock.calls[0]![1] as SyncBatchBody;
    expect(body.ops).toHaveLength(1);
    expect(body.ops[0]!.payload.marks).toHaveLength(1);
    expect(body.ops[0]!.payload.marks![0]!.student_id).toBe(STUDENT_ID);
  });
});
