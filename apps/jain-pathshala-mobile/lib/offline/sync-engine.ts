/**
 * Offline sync engine — sole client transport is POST /v1/sync/batch.
 */
import { apiPost } from "@/lib/api";
import { backoffDelayMs, MAX_ATTEMPTS, shouldRetry } from "./backoff";
import { planDrain } from "./drain";
import { DRAIN_ORDER, QUEUE_OP_TYPE, QUEUE_KEYS, type QueueKey } from "./queue-keys";
import { readAllQueues, removeOp, updateOp, enqueueOp } from "./storage";
import type {
  PendingAttendanceOp,
  PendingCheckInOp,
  PendingCheckOutOp,
  PendingHomeworkSubmissionOp,
  QueuedOp,
  SyncUiState,
} from "./types";
import { ulid } from "./ulid";

type SyncBatchResult = {
  submission_op_id: string;
  status: "success" | "duplicate" | "conflict" | "failed";
  server_id?: string;
  error?: { code: string; message: string };
};

type SyncBatchResponse = { results: SyncBatchResult[] };

let draining = false;

function toTransportPayload(queue: QueueKey, op: QueuedOp): unknown {
  // Payloads already match the server contract (batch_id + session_date, never session_id).
  return op.payload;
}

export async function enqueueCheckIn(input: Omit<PendingCheckInOp, "submission_op_id" | "client_timestamp"> & {
  submission_op_id?: string;
}): Promise<string> {
  const submission_op_id = input.submission_op_id ?? ulid();
  const payload: PendingCheckInOp = {
    submission_op_id,
    batch_id: input.batch_id,
    session_date: input.session_date,
    lat: input.lat,
    lng: input.lng,
    accuracy_m: input.accuracy_m,
    client_timestamp: new Date().toISOString(),
  };
  const op: QueuedOp<PendingCheckInOp> = {
    submission_op_id,
    payload,
    state: "queued",
    attempts: 0,
    next_attempt_at: 0,
    created_at: payload.client_timestamp,
  };
  await enqueueOp(QUEUE_KEYS.checkin, op);
  return submission_op_id;
}

export async function enqueueAttendance(input: {
  batch_id: string;
  session_date: string;
  marks: PendingAttendanceOp["marks"];
  marked_at?: string;
}): Promise<string> {
  const submission_op_id = ulid();
  const marked_at = input.marked_at ?? new Date().toISOString();
  const payload: PendingAttendanceOp = {
    submission_op_id,
    batch_id: input.batch_id,
    session_date: input.session_date,
    marks: input.marks.map((m) => ({
      ...m,
      client_op_id: m.client_op_id || ulid(),
    })),
    marked_at,
    client_timestamp: new Date().toISOString(),
  };
  await enqueueOp(QUEUE_KEYS.attendance, {
    submission_op_id,
    payload,
    state: "queued",
    attempts: 0,
    next_attempt_at: 0,
    created_at: payload.client_timestamp,
  });
  return submission_op_id;
}

export async function enqueueCheckOut(input: Omit<PendingCheckOutOp, "submission_op_id" | "client_timestamp"> & {
  submission_op_id?: string;
}): Promise<string> {
  const submission_op_id = input.submission_op_id ?? ulid();
  const payload: PendingCheckOutOp = {
    submission_op_id,
    batch_id: input.batch_id,
    session_date: input.session_date,
    lat: input.lat,
    lng: input.lng,
    accuracy_m: input.accuracy_m,
    client_timestamp: new Date().toISOString(),
  };
  await enqueueOp(QUEUE_KEYS.checkout, {
    submission_op_id,
    payload,
    state: "queued",
    attempts: 0,
    next_attempt_at: 0,
    created_at: payload.client_timestamp,
  });
  return submission_op_id;
}

export async function enqueueHomeworkSubmission(input: {
  assignment_id: string;
  student_id: string;
  submission_id?: string;
  proof_asset_id?: string;
}): Promise<string> {
  const submission_op_id = ulid();
  const payload: PendingHomeworkSubmissionOp = {
    submission_op_id,
    assignment_id: input.assignment_id,
    student_id: input.student_id,
    submission_id: input.submission_id,
    proof_asset_id: input.proof_asset_id,
    client_timestamp: new Date().toISOString(),
  };
  await enqueueOp(QUEUE_KEYS.homework_submissions, {
    submission_op_id,
    payload,
    state: "queued",
    attempts: 0,
    next_attempt_at: 0,
    created_at: payload.client_timestamp,
  });
  return submission_op_id;
}

/** Manual retry — never silently discard failed ops. */
export async function retryOp(queue: QueueKey, submissionOpId: string): Promise<void> {
  await updateOp(queue, submissionOpId, {
    state: "queued",
    next_attempt_at: 0,
    last_error: undefined,
  });
  void drainQueues();
}

export async function drainQueues(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const queues = await readAllQueues();
    // Only auto-drain `queued` ops that are due.
    for (const key of DRAIN_ORDER) {
      queues[key] = (queues[key] ?? []).map((op) => op);
    }

    const planned = planDrain(
      Object.fromEntries(
        DRAIN_ORDER.map((k) => [
          k,
          (queues[k] ?? []).filter((op) => op.state === "queued"),
        ]),
      ) as Record<QueueKey, QueuedOp[]>,
    );

    if (planned.length === 0) return;

    // Mark syncing
    for (const { queue, op } of planned) {
      await updateOp(queue, op.submission_op_id, { state: "syncing" });
    }

    const body = {
      ops: planned.map(({ queue, op }) => ({
        submission_op_id: op.submission_op_id,
        op_type: QUEUE_OP_TYPE[queue],
        payload: toTransportPayload(queue, op),
        client_timestamp:
          (op.payload as { client_timestamp?: string }).client_timestamp ??
          new Date().toISOString(),
      })),
    };

    let results: SyncBatchResult[] = [];
    let transportFailed = false;
    let httpStatus: number | undefined;

    try {
      const res = await apiPost<SyncBatchResponse>("/v1/sync/batch", body);
      results = res.results ?? [];
    } catch (err) {
      transportFailed = true;
      const e = err as { status?: number; code?: string; message?: string };
      httpStatus = e.status;
      // Apply same failure to every op in the batch slice.
      results = planned.map(({ op }) => ({
        submission_op_id: op.submission_op_id,
        status: "failed" as const,
        error: {
          code: e.code ?? "ERR_NETWORK",
          message: e.message ?? "Network error — will retry.",
        },
      }));
    }

    const byId = new Map(results.map((r) => [r.submission_op_id, r]));

    for (const { queue, op } of planned) {
      const result = byId.get(op.submission_op_id);
      if (!result) {
        await updateOp(queue, op.submission_op_id, {
          state: "queued",
          next_attempt_at: Date.now() + backoffDelayMs(op.attempts + 1),
          attempts: op.attempts + 1,
        });
        continue;
      }

      if (result.status === "success" || result.status === "duplicate") {
        // duplicate → silently dequeue; synced → dequeue after brief state
        const state: SyncUiState = result.status === "duplicate" ? "duplicate" : "synced";
        await updateOp(queue, op.submission_op_id, { state });
        await removeOp(queue, op.submission_op_id);
        continue;
      }

      if (result.status === "conflict") {
        await updateOp(queue, op.submission_op_id, {
          state: "conflict",
          last_error: result.error ?? {
            code: "ERR_CONFLICT",
            message: "This change conflicts with a newer update on the server.",
          },
        });
        continue;
      }

      // failed
      const attempts = op.attempts + 1;
      const statusForRetry = transportFailed ? httpStatus : 400;
      if (shouldRetry(attempts, statusForRetry === 400 && !transportFailed ? 500 : statusForRetry)) {
        // Server returned failed in-band — treat as retryable only for transport.
        // Domain failed (validation) → terminal failed.
        if (transportFailed && shouldRetry(attempts, httpStatus)) {
          await updateOp(queue, op.submission_op_id, {
            state: "queued",
            attempts,
            next_attempt_at: Date.now() + backoffDelayMs(attempts),
            last_error: result.error,
          });
        } else if (transportFailed) {
          await updateOp(queue, op.submission_op_id, {
            state: "failed",
            attempts,
            last_error: result.error,
          });
        } else {
          // Per-op failed from server (non-409) — terminal for auto-retry.
          await updateOp(queue, op.submission_op_id, {
            state: attempts >= MAX_ATTEMPTS ? "failed" : "queued",
            attempts,
            next_attempt_at:
              attempts >= MAX_ATTEMPTS ? Date.now() : Date.now() + backoffDelayMs(attempts),
            last_error: result.error,
          });
          // Domain failures (4xx in result.error) should be terminal.
          const code = result.error?.code ?? "";
          if (code.startsWith("ERR_") && code !== "ERR_NETWORK" && code !== "ERR_INTERNAL") {
            await updateOp(queue, op.submission_op_id, {
              state: "failed",
              attempts,
              last_error: result.error,
            });
          }
        }
      } else {
        await updateOp(queue, op.submission_op_id, {
          state: "failed",
          attempts,
          last_error: result.error,
        });
      }
    }
  } finally {
    draining = false;
  }
}

/** Start periodic drain (call once from app root). */
export function startSyncLoop(intervalMs = 5_000): () => void {
  const tick = () => {
    void (async () => {
      try {
        const { resumeHomeworkProofUploads } = await import(
          "./media-upload-queue"
        );
        await resumeHomeworkProofUploads();
      } catch {
        /* media drain is best-effort */
      }
      await drainQueues();
    })();
  };
  const id = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(id);
}
