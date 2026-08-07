import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAttendanceBlockedByCheckin, planDrain, sessionKey } from "../drain";
import { QUEUE_KEYS, DRAIN_ORDER, type QueueKey } from "../queue-keys";
import type { QueuedOp } from "../types";

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

import { clearAllQueues, readQueue } from "../storage";
import { enqueueHomeworkSubmission, drainQueues } from "../sync-engine";

function op(
  id: string,
  state: QueuedOp["state"],
  payload: Record<string, unknown>,
): QueuedOp {
  return {
    submission_op_id: id,
    payload: payload as QueuedOp["payload"],
    state,
    attempts: state === "failed" ? 10 : 0,
    next_attempt_at: 0,
    created_at: new Date().toISOString(),
  };
}

function emptyQueues(): Record<QueueKey, QueuedOp[]> {
  return {
    [QUEUE_KEYS.checkin]: [],
    [QUEUE_KEYS.attendance]: [],
    [QUEUE_KEYS.checkout]: [],
    [QUEUE_KEYS.shivir_scans]: [],
    [QUEUE_KEYS.niyam_submissions]: [],
    [QUEUE_KEYS.homework_submissions]: [],
    [QUEUE_KEYS.course_progress]: [],
    [QUEUE_KEYS.course_certification]: [],
    [QUEUE_KEYS.acknowledgements]: [],
  };
}

describe("drain order + escape hatch", () => {
  it("drains checkin before attendance before checkout", () => {
    const batch = "11111111-1111-4111-8111-111111111111";
    const date = "2026-08-02";
    const queues = {
      ...emptyQueues(),
      [QUEUE_KEYS.checkin]: [
        op("01CHECKIN00000000000000001", "queued", {
          batch_id: batch,
          session_date: date,
        }),
      ],
      [QUEUE_KEYS.attendance]: [
        op("01ATTEND000000000000000001", "queued", {
          batch_id: batch,
          session_date: date,
          marks: [],
        }),
      ],
      [QUEUE_KEYS.checkout]: [
        op("01CHECKOUT0000000000000001", "queued", {
          batch_id: batch,
          session_date: date,
        }),
      ],
    } as Record<QueueKey, QueuedOp[]>;

    // Attendance blocked while checkin pending; checkout waits for attendance.
    const blocked = planDrain(queues);
    expect(blocked.map((x) => x.queue)).toEqual([QUEUE_KEYS.checkin]);

    // After checkin leaves the pending set, attendance releases; checkout still waits.
    queues[QUEUE_KEYS.checkin] = [];
    const mid = planDrain(queues);
    expect(mid.map((x) => x.queue)).toEqual([QUEUE_KEYS.attendance]);

    // After attendance clears, checkout drains.
    queues[QUEUE_KEYS.attendance] = [];
    const released = planDrain(queues);
    expect(released.map((x) => x.queue)).toEqual([QUEUE_KEYS.checkout]);
  });

  it("a queued check-in blocks attendance for the same (batch_id, session_date)", () => {
    const batch = "11111111-1111-4111-8111-111111111111";
    const date = "2026-08-02";
    const gate = isAttendanceBlockedByCheckin(batch, date, [
      op("01CHECKIN00000000000000001", "queued", {
        batch_id: batch,
        session_date: date,
      }),
    ]);
    expect(gate.blocked).toBe(true);
    expect(gate.reason).toBe("pending");
    expect(sessionKey(batch, date)).toBe(`${batch}|${date}`);
  });

  it("releases attendance when checkin is FAILED (escape hatch)", () => {
    const batch = "11111111-1111-4111-8111-111111111111";
    const date = "2026-08-02";
    const checkins = [
      op("01CHECKIN00000000000000001", "failed", {
        batch_id: batch,
        session_date: date,
      }),
    ];
    const gate = isAttendanceBlockedByCheckin(batch, date, checkins);
    expect(gate.blocked).toBe(false);
    expect(gate.reason).toBe("failed_escape");

    const queues = {
      ...emptyQueues(),
      [QUEUE_KEYS.checkin]: checkins,
      [QUEUE_KEYS.attendance]: [
        op("01ATTEND000000000000000001", "queued", {
          batch_id: batch,
          session_date: date,
          marks: [],
        }),
      ],
    } as Record<QueueKey, QueuedOp[]>;

    const planned = planDrain(queues);
    expect(planned.map((x) => x.queue)).toContain(QUEUE_KEYS.attendance);
  });

  it("check-out never drains before the attendance ops for its session", () => {
    const batch = "11111111-1111-4111-8111-111111111111";
    const date = "2026-08-02";
    const otherBatch = "22222222-2222-4222-8222-222222222222";
    const queues = {
      ...emptyQueues(),
      [QUEUE_KEYS.attendance]: [
        op("01ATTEND000000000000000001", "queued", {
          batch_id: batch,
          session_date: date,
          marks: [],
        }),
      ],
      [QUEUE_KEYS.checkout]: [
        op("01CHECKOUT0000000000000001", "queued", {
          batch_id: batch,
          session_date: date,
        }),
        op("01CHECKOUT0000000000000002", "queued", {
          batch_id: otherBatch,
          session_date: date,
        }),
      ],
    } as Record<QueueKey, QueuedOp[]>;

    const planned = planDrain(queues);
    expect(planned.map((x) => x.op.submission_op_id)).toEqual([
      "01ATTEND000000000000000001",
      "01CHECKOUT0000000000000002",
    ]);
  });

  it("blocks attendance while checkin is PENDING for same session key", () => {
    const batch = "11111111-1111-4111-8111-111111111111";
    const date = "2026-08-02";
    const gate = isAttendanceBlockedByCheckin(batch, date, [
      op("01CHECKIN00000000000000001", "queued", {
        batch_id: batch,
        session_date: date,
      }),
    ]);
    expect(gate.blocked).toBe(true);
    expect(gate.reason).toBe("pending");
  });
});

describe("homework offline queue", () => {
  beforeEach(async () => {
    mem.clear();
    apiPost.mockReset();
    await clearAllQueues();
  });

  it("a homework submission enqueues to jp.queue.homework_submissions", async () => {
    const id = await enqueueHomeworkSubmission({
      assignment_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      student_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      proof_asset_id: "https://example.com/hw.jpg",
    });
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const queued = await readQueue(QUEUE_KEYS.homework_submissions);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.submission_op_id).toBe(id);
    expect(queued[0]!.state).toBe("queued");
    expect(queued[0]!.payload).toMatchObject({
      assignment_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      student_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      proof_asset_id: "https://example.com/hw.jpg",
    });
    expect(queued[0]!.payload).toHaveProperty("client_timestamp");
  });

  it("queued homework ops drain in DRAIN_ORDER after niyam_submissions", () => {
    const queues = {
      ...emptyQueues(),
      [QUEUE_KEYS.niyam_submissions]: [
        op("01NIYAM0000000000000000001", "queued", {
          niyam_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          student_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        }),
      ],
      [QUEUE_KEYS.homework_submissions]: [
        op("01HOMEWORK0000000000000001", "queued", {
          assignment_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          student_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        }),
      ],
      [QUEUE_KEYS.acknowledgements]: [
        op("01ACK000000000000000000001", "queued", {
          kind: "notice",
          entity_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        }),
      ],
    } as Record<QueueKey, QueuedOp[]>;

    const planned = planDrain(queues);
    expect(planned.map((x) => x.queue)).toEqual([
      QUEUE_KEYS.niyam_submissions,
      QUEUE_KEYS.homework_submissions,
      QUEUE_KEYS.acknowledgements,
    ]);

    const hwIdx = DRAIN_ORDER.indexOf(QUEUE_KEYS.homework_submissions);
    const niyamIdx = DRAIN_ORDER.indexOf(QUEUE_KEYS.niyam_submissions);
    expect(hwIdx).toBeGreaterThan(niyamIdx);
  });

  it("course_progress drains before course_certification before acknowledgements", () => {
    const queues = {
      ...emptyQueues(),
      [QUEUE_KEYS.course_progress]: [
        op("01COURSEPROG00000000000001", "queued", {
          node_kind: "section",
          node_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          marks: [],
          marked_at: new Date().toISOString(),
        }),
      ],
      [QUEUE_KEYS.course_certification]: [
        op("01COURSECERT00000000000001", "queued", {
          node_kind: "section",
          node_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          student_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        }),
      ],
      [QUEUE_KEYS.acknowledgements]: [
        op("01ACK000000000000000000002", "queued", {
          kind: "notice",
          entity_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        }),
      ],
    } as Record<QueueKey, QueuedOp[]>;

    const planned = planDrain(queues);
    expect(planned.map((x) => x.queue)).toEqual([
      QUEUE_KEYS.course_progress,
      QUEUE_KEYS.course_certification,
      QUEUE_KEYS.acknowledgements,
    ]);

    // Failed progress must not block certification (no ordering guard).
    const blocked = {
      ...emptyQueues(),
      [QUEUE_KEYS.course_progress]: [
        op("01COURSEPROG00000000000002", "failed", {
          node_kind: "section",
          node_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
      ],
      [QUEUE_KEYS.course_certification]: [
        op("01COURSECERT00000000000002", "queued", {
          node_kind: "section",
          node_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          student_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        }),
      ],
    } as Record<QueueKey, QueuedOp[]>;
    const plannedAfterFail = planDrain(blocked);
    expect(plannedAfterFail.map((x) => x.queue)).toEqual([QUEUE_KEYS.course_certification]);
  });

  it("a failed homework op moves to the `failed` UI state and is not discarded", async () => {
    const id = await enqueueHomeworkSubmission({
      assignment_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      student_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      proof_asset_id: "https://example.com/hw.jpg",
    });

    apiPost.mockResolvedValue({
      results: [
        {
          submission_op_id: id,
          status: "failed",
          error: {
            code: "ERR_VALIDATION_FAILED",
            message: "That submission link is not a valid http(s) URL — check it and try again.",
          },
        },
      ],
    });

    await drainQueues();

    const queued = await readQueue(QUEUE_KEYS.homework_submissions);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.submission_op_id).toBe(id);
    expect(queued[0]!.state).toBe("failed");
    expect(queued[0]!.last_error?.code).toBe("ERR_VALIDATION_FAILED");
  });
});
