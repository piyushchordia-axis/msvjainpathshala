/**
 * `attendance` drain — wired into the sync engine via `registerDrain('attendance', …)`.
 *
 * Strategy:
 *   1. Snapshot the attendance queue.
 *   2. Group ops by `session_id`. Skip ops with `session_id === null`
 *      (their owning check-in hasn't completed yet — they'll get rewritten
 *      with a real session id by the marking screen).
 *   3. For each group, POST `/v1/attendance/mark`. On success, dequeue the
 *      group. On retryable error (network / 5xx / 429), bump attempt
 *      counter and leave the ops in the queue. On 4xx (validation,
 *      idempotency conflict), drop the ops — the user has to reconcile
 *      from the "Sync issues" drawer (UI delivery in a later step).
 *
 * Idempotency is per-mark — each item carries its own `client_op_id` and the
 * server's `attendance.client_op_id` UNIQUE index treats replays as no-ops.
 */

import { ApiError } from '@/api/client';
import { attendanceQueue, type AttendanceOpPayload } from '@/storage/stores/queue/attendance.store';

import { attendanceApi, type MarkItem } from './attendance.api';

import type { PendingOp } from '@/storage/types';

const RETRYABLE_STATUS = new Set([0, 408, 425, 429, 500, 502, 503, 504]);

export async function attendanceDrain(): Promise<void> {
  const all = attendanceQueue.getAll();
  if (all.length === 0) return;

  const bySession = new Map<string, PendingOp<AttendanceOpPayload>[]>();
  for (const op of all) {
    const sid = op.payload.session_id;
    if (!sid) continue;
    const list = bySession.get(sid);
    if (list) list.push(op);
    else bySession.set(sid, [op]);
  }
  if (bySession.size === 0) return;

  for (const [sessionId, group] of bySession.entries()) {
    const marks: MarkItem[] = group.map((op) => ({
      student_id: op.payload.student_id,
      status: op.payload.status,
      client_op_id: op.client_op_id,
      ...(op.payload.notes ? { notes: op.payload.notes } : {}),
    }));
    try {
      await attendanceApi.mark({ session_id: sessionId, marks });
      // success — dequeue all members.
      for (const op of group) attendanceQueue.dequeue(op.client_op_id);
    } catch (err) {
      const isRetryable = err instanceof ApiError ? RETRYABLE_STATUS.has(err.statusCode) : true;
      if (isRetryable) {
        for (const op of group) {
          attendanceQueue.updateAttempt(op.client_op_id, summarize(err));
        }
        // Halt this tick — the next sync tick will retry per the engine's
        // exponential schedule. Bubbling the error lets the engine flip
        // status to 'error'.
        throw err;
      }
      // Permanent: drop the ops with a logged error. (Future step adds a
      // dead-letter queue + UI for manual review.)
      for (const op of group) attendanceQueue.dequeue(op.client_op_id);

      console.warn(
        `[attendance-drain] dropping ${group.length} ops for session ${sessionId}: ${summarize(err)}`,
      );
    }
  }
}

function summarize(err: unknown): string {
  if (err instanceof ApiError) return `${err.statusCode} ${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
