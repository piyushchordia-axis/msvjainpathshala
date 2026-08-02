import { describe, expect, it } from "vitest";
import { isAttendanceBlockedByCheckin, planDrain, sessionKey } from "../drain";
import { QUEUE_KEYS, type QueueKey } from "../queue-keys";
import type { QueuedOp } from "../types";

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

describe("drain order + escape hatch", () => {
  it("drains checkin before attendance before checkout", () => {
    const batch = "11111111-1111-4111-8111-111111111111";
    const date = "2026-08-02";
    const queues = {
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
      [QUEUE_KEYS.shivir_scans]: [],
      [QUEUE_KEYS.niyam_submissions]: [],
      [QUEUE_KEYS.homework_submissions]: [],
      [QUEUE_KEYS.acknowledgements]: [],
    } as Record<QueueKey, QueuedOp[]>;

    // Attendance blocked while checkin pending.
    const blocked = planDrain(queues);
    expect(blocked.map((x) => x.queue)).toEqual([
      QUEUE_KEYS.checkin,
      QUEUE_KEYS.checkout,
    ]);

    // After checkin leaves the pending set, attendance releases.
    queues[QUEUE_KEYS.checkin] = [];
    const released = planDrain(queues);
    expect(released.map((x) => x.queue)).toEqual([
      QUEUE_KEYS.attendance,
      QUEUE_KEYS.checkout,
    ]);
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
      [QUEUE_KEYS.checkin]: checkins,
      [QUEUE_KEYS.attendance]: [
        op("01ATTEND000000000000000001", "queued", {
          batch_id: batch,
          session_date: date,
          marks: [],
        }),
      ],
      [QUEUE_KEYS.checkout]: [],
      [QUEUE_KEYS.shivir_scans]: [],
      [QUEUE_KEYS.niyam_submissions]: [],
      [QUEUE_KEYS.homework_submissions]: [],
      [QUEUE_KEYS.acknowledgements]: [],
    } as Record<QueueKey, QueuedOp[]>;

    const planned = planDrain(queues);
    expect(planned.map((x) => x.queue)).toContain(QUEUE_KEYS.attendance);
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
    expect(sessionKey(batch, date)).toBe(`${batch}|${date}`);
  });
});
