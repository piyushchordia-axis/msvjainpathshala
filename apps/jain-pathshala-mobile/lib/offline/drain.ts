/**
 * Causal drain planner + ordering guard with FAILED escape hatch.
 *
 * Drain order: checkin → attendance → checkout → …
 * Attendance blocked while checkin is PENDING for same (batch_id, session_date).
 * Attendance RELEASED if checkin is FAILED (AT8 escape hatch).
 * Checkout blocked while attendance is PENDING for the same session key
 * (marks must land before the session closes).
 */
import { DRAIN_ORDER, QUEUE_KEYS, type QueueKey } from "./queue-keys";
import type {
  PendingAttendanceOp,
  PendingCheckInOp,
  PendingCheckOutOp,
  QueuedOp,
} from "./types";

export type SessionKey = string; // `${batch_id}|${session_date}`

export function sessionKey(batchId: string, sessionDate: string): SessionKey {
  return `${batchId}|${sessionDate}`;
}

function keyFromCheckin(op: QueuedOp): SessionKey | null {
  const p = op.payload as PendingCheckInOp;
  if (!p?.batch_id || !p?.session_date) return null;
  return sessionKey(p.batch_id, p.session_date);
}

function keyFromAttendance(op: QueuedOp): SessionKey | null {
  const p = op.payload as PendingAttendanceOp;
  if (!p?.batch_id || !p?.session_date) return null;
  return sessionKey(p.batch_id, p.session_date);
}

function keyFromCheckout(op: QueuedOp): SessionKey | null {
  const p = op.payload as PendingCheckOutOp;
  if (!p?.batch_id || !p?.session_date) return null;
  return sessionKey(p.batch_id, p.session_date);
}

/**
 * Returns ops to send now, in causal order, respecting:
 * - Within a queue: submission_op_id ascending
 * - Attendance blocked while checkin is PENDING for same (batch_id, session_date)
 * - Attendance RELEASED if checkin is FAILED (escape hatch / AT8)
 * - Checkout blocked while attendance is PENDING for same session key
 */
export function planDrain(
  queues: Record<QueueKey, QueuedOp[]>,
  now = Date.now(),
): Array<{ queue: QueueKey; op: QueuedOp }> {
  const ready = (ops: QueuedOp[]) =>
    ops
      .filter((op) => op.state === "queued" && op.next_attempt_at <= now)
      .sort((a, b) => a.submission_op_id.localeCompare(b.submission_op_id));

  const checkins = queues[QUEUE_KEYS.checkin] ?? [];
  const pendingCheckinKeys = new Set(
    checkins
      .filter((op) => op.state === "queued" || op.state === "syncing")
      .map(keyFromCheckin)
      .filter((k): k is string => !!k),
  );
  const failedCheckinKeys = new Set(
    checkins
      .filter((op) => op.state === "failed")
      .map(keyFromCheckin)
      .filter((k): k is string => !!k),
  );

  const attendanceOps = queues[QUEUE_KEYS.attendance] ?? [];
  const pendingAttendanceKeys = new Set(
    attendanceOps
      .filter((op) => op.state === "queued" || op.state === "syncing")
      .map(keyFromAttendance)
      .filter((k): k is string => !!k),
  );

  const planned: Array<{ queue: QueueKey; op: QueuedOp }> = [];

  for (const queue of DRAIN_ORDER) {
    const ops = ready(queues[queue] ?? []).filter((op) => {
      if (queue === QUEUE_KEYS.attendance) {
        const k = keyFromAttendance(op);
        if (!k) return true;
        // Ordering guard: block while checkin PENDING for same key.
        if (pendingCheckinKeys.has(k)) return false;
        // Escape hatch: FAILED checkin does NOT block (AT8 soft-create on server).
        if (failedCheckinKeys.has(k)) return true;
        return true;
      }
      if (queue === QUEUE_KEYS.checkout) {
        const k = keyFromCheckout(op);
        if (!k) return true;
        // Check-out must not close a session before its marks arrive.
        if (pendingAttendanceKeys.has(k)) return false;
        return true;
      }
      return true;
    });

    for (const op of ops) {
      planned.push({ queue, op });
    }
  }

  return planned;
}

/** Pure helper exported for tests — is attendance blocked by pending checkin? */
export function isAttendanceBlockedByCheckin(
  batchId: string,
  sessionDate: string,
  checkinOps: QueuedOp[],
): { blocked: boolean; reason: "pending" | "failed_escape" | "none" } {
  const k = sessionKey(batchId, sessionDate);
  const pending = checkinOps.some(
    (op) =>
      (op.state === "queued" || op.state === "syncing") && keyFromCheckin(op) === k,
  );
  if (pending) return { blocked: true, reason: "pending" };
  const failed = checkinOps.some(
    (op) => op.state === "failed" && keyFromCheckin(op) === k,
  );
  if (failed) return { blocked: false, reason: "failed_escape" };
  return { blocked: false, reason: "none" };
}
