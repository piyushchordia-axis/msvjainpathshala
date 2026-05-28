/**
 * Unified `batchDrain` — replaces the per-feature drain functions registered
 * with the engine in Step 8/13.
 *
 * Behaviour (CLAUDE.md "Offline sync rules"):
 *   1. Collect every PendingOp from the four MMKV queues in priority order:
 *      attendance → shivir_scans → niyam_submissions → acknowledgements.
 *   2. Transform each one into the wire `SyncOperationDto` shape. Skip
 *      attendance ops with a null session_id (their owning check-in hasn't
 *      completed yet — the marking screen rewrites them later).
 *   3. POST to `/v1/sync/batch` in chunks of 50 ops, sequentially (the
 *      backend dispatches ops serially within one batch; sending parallel
 *      large batches would mostly fight row locks).
 *   4. Per-op result:
 *        success    → dequeue from source queue, bump drained-toast counter
 *        duplicate  → dequeue (already applied)
 *        failed     → write to failedOpsStore + dequeue + emit conflict
 *                     event if `ERR_SYNC_CONFLICT`
 *   5. Network or 5xx errors bubble up: ops stay in their queues with an
 *      `attempts++`, and the engine flips status to 'error' so the next
 *      tick retries.
 */

import { ApiError } from '@/api/client';
import {
  acknowledgementsQueue,
  attendanceQueue,
  failedOpsStore,
  niyamSubmissionsQueue,
  shivirScansQueue,
  type FailedQueueName,
} from '@/storage';
import { useSyncIssuesStore } from '@/stores/sync-issues.store';
import { syncApi } from '@/sync/sync.api';

import type { AcknowledgementOpPayload } from '@/storage/stores/queue/acknowledgements.store';
import type { AttendanceOpPayload } from '@/storage/stores/queue/attendance.store';
import type { NiyamSubmissionOpPayload } from '@/storage/stores/queue/niyam-submissions.store';
import type { ShivirScanOpPayload } from '@/storage/stores/queue/shivir-scans.store';
import type { PendingOp } from '@/storage/types';
import type { SyncOperationDto, SyncResultDto } from '@jp/shared';

/** Server caps batches at 200; we use 50 to keep per-request latency bounded. */
const BATCH_SIZE = 50;

const RETRYABLE_STATUS = new Set([0, 408, 425, 429, 500, 502, 503, 504]);

interface CollectedOp {
  dto: SyncOperationDto;
  source_queue: FailedQueueName;
  pending: PendingOp<unknown>;
}

/**
 * Snapshot every queue in priority order. We snapshot (rather than reading
 * + dequeuing in lockstep) so the engine has a stable working set even if
 * an enqueue happens mid-flight.
 */
function collectAll(): CollectedOp[] {
  const out: CollectedOp[] = [];

  // 1. attendance (highest priority)
  for (const op of attendanceQueue.getAll() as PendingOp<AttendanceOpPayload>[]) {
    if (!op.payload.session_id) continue; // pre-checkin op — skip until session resolves
    out.push({
      source_queue: 'attendance',
      pending: op,
      dto: {
        client_op_id: op.client_op_id,
        op_kind: 'attendance.mark',
        payload: {
          session_id: op.payload.session_id,
          student_id: op.payload.student_id,
          status: op.payload.status,
          marked_at: op.payload.marked_at,
          ...(op.payload.notes !== undefined && op.payload.notes !== null
            ? { notes: op.payload.notes }
            : {}),
        },
        client_timestamp: op.created_at,
      },
    });
  }

  // 2. shivir scans
  for (const op of shivirScansQueue.getAll() as PendingOp<ShivirScanOpPayload>[]) {
    out.push({
      source_queue: 'shivir_scans',
      pending: op,
      dto: {
        client_op_id: op.client_op_id,
        op_kind: 'shivir.scan',
        payload: op.payload as unknown as Record<string, unknown>,
        client_timestamp: op.created_at,
      },
    });
  }

  // 3. niyam submissions
  for (const op of niyamSubmissionsQueue.getAll() as PendingOp<NiyamSubmissionOpPayload>[]) {
    out.push({
      source_queue: 'niyam_submissions',
      pending: op,
      dto: {
        client_op_id: op.client_op_id,
        op_kind: 'niyam.submission',
        payload: op.payload as unknown as Record<string, unknown>,
        client_timestamp: op.created_at,
      },
    });
  }

  // 4. acknowledgements
  for (const op of acknowledgementsQueue.getAll() as PendingOp<AcknowledgementOpPayload>[]) {
    out.push({
      source_queue: 'acknowledgements',
      pending: op,
      dto: {
        client_op_id: op.client_op_id,
        op_kind: 'notice.acknowledge',
        payload: op.payload as unknown as Record<string, unknown>,
        client_timestamp: op.created_at,
      },
    });
  }

  return out;
}

function dequeueByQueue(queue: FailedQueueName, client_op_id: string): void {
  switch (queue) {
    case 'attendance':
      attendanceQueue.dequeue(client_op_id);
      return;
    case 'shivir_scans':
      shivirScansQueue.dequeue(client_op_id);
      return;
    case 'niyam_submissions':
      niyamSubmissionsQueue.dequeue(client_op_id);
      return;
    case 'acknowledgements':
      acknowledgementsQueue.dequeue(client_op_id);
      return;
  }
}

function bumpAttempt(queue: FailedQueueName, client_op_id: string, err: string): void {
  switch (queue) {
    case 'attendance':
      attendanceQueue.updateAttempt(client_op_id, err);
      return;
    case 'shivir_scans':
      shivirScansQueue.updateAttempt(client_op_id, err);
      return;
    case 'niyam_submissions':
      niyamSubmissionsQueue.updateAttempt(client_op_id, err);
      return;
    case 'acknowledgements':
      acknowledgementsQueue.updateAttempt(client_op_id, err);
      return;
  }
}

function summariseError(err: unknown): string {
  if (err instanceof ApiError) return `${err.statusCode} ${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Drain one cycle. Returns the per-op outcomes so the engine can log /
 * report. Throws on retryable network errors so the engine can flip its
 * status to 'error' and schedule a backoff retry.
 */
export interface DrainStats {
  succeeded: number;
  duplicates: number;
  failed: number;
  conflicts: number;
  total: number;
}

export async function batchDrain(): Promise<DrainStats> {
  const collected = collectAll();
  if (collected.length === 0) {
    return { succeeded: 0, duplicates: 0, failed: 0, conflicts: 0, total: 0 };
  }

  const stats: DrainStats = {
    succeeded: 0,
    duplicates: 0,
    failed: 0,
    conflicts: 0,
    total: collected.length,
  };
  const byOpId = new Map<string, CollectedOp>(collected.map((c) => [c.dto.client_op_id, c]));

  for (let i = 0; i < collected.length; i += BATCH_SIZE) {
    const slice = collected.slice(i, i + BATCH_SIZE);
    let response;
    try {
      response = await syncApi.batch(slice.map((s) => s.dto));
    } catch (err) {
      const isRetryable = err instanceof ApiError ? RETRYABLE_STATUS.has(err.statusCode) : true;
      const summary = summariseError(err);
      // Bump attempts for the WHOLE slice (the server didn't accept it).
      for (const s of slice) bumpAttempt(s.source_queue, s.dto.client_op_id, summary);
      if (isRetryable) throw err; // engine catches → status='error', backoff
      // 4xx but not a per-op envelope → treat as permanent for this slice.
      for (const s of slice) {
        failedOpsStore.record({
          client_op_id: s.dto.client_op_id,
          source_queue: s.source_queue,
          op_kind: s.dto.op_kind,
          error_code: err instanceof ApiError ? err.code : 'ERR_INTERNAL',
          error_message: summary,
          pending_op: s.pending,
        });
        dequeueByQueue(s.source_queue, s.dto.client_op_id);
        stats.failed += 1;
      }
      continue;
    }

    for (const result of response.results as SyncResultDto[]) {
      const op = byOpId.get(result.client_op_id);
      if (!op) continue;
      switch (result.status) {
        case 'success':
          dequeueByQueue(op.source_queue, op.dto.client_op_id);
          stats.succeeded += 1;
          break;
        case 'duplicate':
          dequeueByQueue(op.source_queue, op.dto.client_op_id);
          stats.duplicates += 1;
          break;
        case 'failed': {
          const code = result.error_code ?? 'ERR_SYNC_FAILED';
          const message = result.error_message ?? 'Operation failed';
          failedOpsStore.record({
            client_op_id: op.dto.client_op_id,
            source_queue: op.source_queue,
            op_kind: op.dto.op_kind,
            error_code: code,
            error_message: message,
            pending_op: op.pending,
          });
          dequeueByQueue(op.source_queue, op.dto.client_op_id);
          stats.failed += 1;
          if (code === 'ERR_SYNC_CONFLICT') {
            stats.conflicts += 1;
            useSyncIssuesStore.getState().reportConflict({
              client_op_id: op.dto.client_op_id,
              op_kind: op.dto.op_kind,
              error_code: code,
              error_message: message,
              source_queue: op.source_queue,
            });
          }
          break;
        }
      }
    }
  }

  // Update the toast counter and failed-count mirror for the UI.
  if (stats.succeeded + stats.duplicates > 0) {
    useSyncIssuesStore.getState().bumpDrained(stats.succeeded + stats.duplicates);
  }
  useSyncIssuesStore.getState().setFailedCount(failedOpsStore.count());

  return stats;
}
