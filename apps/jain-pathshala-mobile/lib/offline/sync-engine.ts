/**
 * Offline sync engine — sole client transport is POST /v1/sync/batch.
 */
import NetInfo from "@react-native-community/netinfo";
import { AppState, type AppStateStatus } from "react-native";
import { apiPost } from "@/lib/api";
import { backoffDelayMs, MAX_ATTEMPTS, shouldRetry } from "./backoff";
import { planDrain } from "./drain";
import { DRAIN_ORDER, QUEUE_OP_TYPE, QUEUE_KEYS, type QueueKey } from "./queue-keys";
import { readAllQueues, writeQueue, enqueueOp } from "./storage";
import type {
  PendingAcknowledgementOp,
  PendingAttendanceOp,
  PendingCheckInOp,
  PendingCheckOutOp,
  PendingCourseCertificationOp,
  PendingCourseProgressOp,
  PendingHomeworkSubmissionOp,
  QueuedOp,
  SyncUiState,
} from "./types";
import { ulid } from "./ulid";

/** Per-op outcome from POST /v1/sync/batch — also returned by drainQueues. */
export type DrainOpResult = {
  submission_op_id: string;
  status: "success" | "duplicate" | "conflict" | "failed";
  server_id?: string;
  error?: { code: string; message: string };
};

type SyncBatchResult = DrainOpResult;
type SyncBatchResponse = { results: SyncBatchResult[] };

let draining = false;

const ACTIVE_INTERVAL_MS = 5_000;
const IDLE_INTERVAL_MS = 60_000;

function toTransportPayload(_queue: QueueKey, op: QueuedOp): unknown {
  return op.payload;
}

async function flushDirtyQueues(
  queues: Record<QueueKey, QueuedOp[]>,
  dirty: Set<QueueKey>,
): Promise<void> {
  for (const key of dirty) {
    await writeQueue(key, queues[key] ?? []);
  }
  dirty.clear();
}

function findOpIndex(arr: QueuedOp[], submissionOpId: string): number {
  return arr.findIndex((o) => o.submission_op_id === submissionOpId);
}

function applyDrainResult(
  op: QueuedOp,
  result: SyncBatchResult | undefined,
  transportFailed: boolean,
  httpStatus: number | undefined,
): "remove" | QueuedOp {
  if (!result) {
    const attempts = op.attempts + 1;
    return {
      ...op,
      state: "queued",
      next_attempt_at: Date.now() + backoffDelayMs(attempts),
      attempts,
    };
  }

  if (result.status === "success" || result.status === "duplicate") {
    return "remove";
  }

  if (result.status === "conflict") {
    return {
      ...op,
      state: "conflict",
      last_error: result.error ?? {
        code: "ERR_CONFLICT",
        message: "This change conflicts with a newer update on the server.",
      },
    };
  }

  const attempts = op.attempts + 1;
  const statusForRetry = transportFailed ? httpStatus : 400;
  if (shouldRetry(attempts, statusForRetry === 400 && !transportFailed ? 500 : statusForRetry)) {
    if (transportFailed && shouldRetry(attempts, httpStatus)) {
      return {
        ...op,
        state: "queued",
        attempts,
        next_attempt_at: Date.now() + backoffDelayMs(attempts),
        last_error: result.error,
      };
    }
    if (transportFailed) {
      return {
        ...op,
        state: "failed",
        attempts,
        last_error: result.error,
      };
    }
    let next: QueuedOp = {
      ...op,
      state: attempts >= MAX_ATTEMPTS ? "failed" : "queued",
      attempts,
      next_attempt_at:
        attempts >= MAX_ATTEMPTS ? Date.now() : Date.now() + backoffDelayMs(attempts),
      last_error: result.error,
    };
    const code = result.error?.code ?? "";
    if (code.startsWith("ERR_") && code !== "ERR_NETWORK" && code !== "ERR_INTERNAL") {
      next = {
        ...next,
        state: "failed",
        attempts,
        last_error: result.error,
      };
    }
    return next;
  }

  return {
    ...op,
    state: "failed",
    attempts,
    last_error: result.error,
  };
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

export async function enqueueCourseProgress(input: {
  node_kind: "section" | "subsection";
  node_id: string;
  marks: PendingCourseProgressOp["marks"];
  marked_at?: string;
}): Promise<string> {
  const submission_op_id = ulid();
  const marked_at = input.marked_at ?? new Date().toISOString();
  const payload: PendingCourseProgressOp = {
    submission_op_id,
    node_kind: input.node_kind,
    node_id: input.node_id,
    marks: input.marks.map((m) => ({
      ...m,
      client_op_id: m.client_op_id || ulid(),
    })),
    marked_at,
    client_timestamp: new Date().toISOString(),
  };
  await enqueueOp(QUEUE_KEYS.course_progress, {
    submission_op_id,
    payload,
    state: "queued",
    attempts: 0,
    next_attempt_at: 0,
    created_at: payload.client_timestamp,
  });
  return submission_op_id;
}

/** Exactly one student_id — CU18 forbids bulk certification offline too. */
export async function enqueueCourseCertification(input: {
  node_kind: "section" | "subsection";
  node_id: string;
  student_id: string;
  certification_note?: string;
  certified_at?: string;
  client_op_id?: string;
}): Promise<string> {
  const submission_op_id = ulid();
  const certified_at = input.certified_at ?? new Date().toISOString();
  const payload: PendingCourseCertificationOp = {
    submission_op_id,
    node_kind: input.node_kind,
    node_id: input.node_id,
    student_id: input.student_id,
    certification_note: input.certification_note,
    client_op_id: input.client_op_id || ulid(),
    certified_at,
    client_timestamp: new Date().toISOString(),
  };
  await enqueueOp(QUEUE_KEYS.course_certification, {
    submission_op_id,
    payload,
    state: "queued",
    attempts: 0,
    next_attempt_at: 0,
    created_at: payload.client_timestamp,
  });
  return submission_op_id;
}

/** Parent mark-done acknowledgement — drains via jp.queue.acknowledgements (F1). */
export async function enqueueHomeworkMarkDone(input: {
  submission_id: string;
}): Promise<string> {
  const submission_op_id = ulid();
  const client_timestamp = new Date().toISOString();
  const payload: PendingAcknowledgementOp = {
    submission_op_id,
    kind: "homework.mark_done",
    entity_id: input.submission_id,
    client_timestamp,
  };
  await enqueueOp(QUEUE_KEYS.acknowledgements, {
    submission_op_id,
    payload,
    state: "queued",
    attempts: 0,
    next_attempt_at: 0,
    created_at: client_timestamp,
  });
  return submission_op_id;
}

/** Manual retry — never silently discard failed ops. */
export async function retryOp(queue: QueueKey, submissionOpId: string): Promise<void> {
  const queues = await readAllQueues();
  const arr = queues[queue] ?? [];
  const idx = findOpIndex(arr, submissionOpId);
  if (idx < 0) return;
  arr[idx] = {
    ...arr[idx]!,
    state: "queued",
    next_attempt_at: 0,
    last_error: undefined,
  };
  await writeQueue(queue, arr);
  void drainQueues();
}

/**
 * After a kill mid-POST, ops can remain `syncing` forever — planDrain only
 * picks `queued`. Re-queue orphans so relaunch does not lose work.
 */
async function requeueOrphanedSyncing(
  queues: Record<QueueKey, QueuedOp[]>,
  dirty: Set<QueueKey>,
): Promise<void> {
  for (const key of DRAIN_ORDER) {
    const arr = queues[key] ?? [];
    let changed = false;
    for (let i = 0; i < arr.length; i += 1) {
      if (arr[i]!.state === "syncing") {
        arr[i] = { ...arr[i]!, state: "queued", next_attempt_at: 0 };
        changed = true;
      }
    }
    if (changed) {
      queues[key] = arr;
      dirty.add(key);
    }
  }
}

export async function drainQueues(): Promise<DrainOpResult[]> {
  if (draining) return [];
  draining = true;
  try {
    const queues = await readAllQueues();
    const dirty = new Set<QueueKey>();

    await requeueOrphanedSyncing(queues, dirty);
    if (dirty.size > 0) await flushDirtyQueues(queues, dirty);

    const planned = planDrain(
      Object.fromEntries(
        DRAIN_ORDER.map((k) => [
          k,
          (queues[k] ?? []).filter((op) => op.state === "queued"),
        ]),
      ) as Record<QueueKey, QueuedOp[]>,
    );

    if (planned.length === 0) return [];

    for (const { queue, op } of planned) {
      const arr = queues[queue] ?? [];
      const idx = findOpIndex(arr, op.submission_op_id);
      if (idx >= 0) {
        arr[idx] = { ...arr[idx]!, state: "syncing" as SyncUiState };
        dirty.add(queue);
      }
    }
    await flushDirtyQueues(queues, dirty);

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

    let results: DrainOpResult[] = [];
    let transportFailed = false;
    let httpStatus: number | undefined;

    try {
      const res = await apiPost<SyncBatchResponse>("/v1/sync/batch", body);
      results = res.results ?? [];
    } catch (err) {
      transportFailed = true;
      const e = err as { status?: number; code?: string; message?: string };
      httpStatus = e.status;
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
      const arr = queues[queue] ?? [];
      const idx = findOpIndex(arr, op.submission_op_id);
      if (idx < 0) continue;

      const outcome = applyDrainResult(
        arr[idx]!,
        byId.get(op.submission_op_id),
        transportFailed,
        httpStatus,
      );
      if (outcome === "remove") {
        arr.splice(idx, 1);
      } else {
        arr[idx] = outcome;
      }
      dirty.add(queue);
    }
    await flushDirtyQueues(queues, dirty);
    return results;
  } finally {
    draining = false;
  }
}

async function hasPendingSyncWork(): Promise<boolean> {
  const queues = await readAllQueues();
  return DRAIN_ORDER.some((key) =>
    (queues[key] ?? []).some(
      (op) =>
        op.state === "queued" &&
        (op.next_attempt_at === 0 || op.next_attempt_at <= Date.now()),
    ),
  );
}

/** Start periodic drain (OfflineSyncLoop — shikshak/sanchalak only). */
export function startSyncLoop(): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let appState: AppStateStatus = AppState.currentState;

  const schedule = (ms: number) => {
    if (cancelled) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void tick(), ms);
  };

  const tick = async () => {
    if (cancelled) return;
    if (appState !== "active") {
      schedule(IDLE_INTERVAL_MS);
      return;
    }

    try {
      const { resumeHomeworkProofUploads } = await import("./media-upload-queue");
      await resumeHomeworkProofUploads();
    } catch {
      /* media drain is best-effort */
    }

    await drainQueues();

    const pending = await hasPendingSyncWork();
    schedule(pending ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS);
  };

  const appSub = AppState.addEventListener("change", (next) => {
    appState = next;
    if (next === "active" && !cancelled) void tick();
  });

  const netUnsub = NetInfo.addEventListener((state) => {
    if (state.isConnected && !cancelled) void tick();
  });

  void tick();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    appSub.remove();
    netUnsub();
  };
}

