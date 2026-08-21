/**
 * Offline sync engine — sole client transport is POST /v1/sync/batch.
 */
import NetInfo from "@react-native-community/netinfo";
import { AppState, type AppStateStatus } from "react-native";
import { apiPost } from "@/lib/api";
import { backoffDelayMs, MAX_ATTEMPTS, shouldRetry } from "./backoff";
import { planDrain } from "./drain";
import { DRAIN_ORDER, QUEUE_OP_TYPE, QUEUE_KEYS, type QueueKey } from "./queue-keys";
import { readAllQueues, readQueue, writeQueue, enqueueOp } from "./storage";
import type {
  PendingAcknowledgementOp,
  PendingAttendanceOp,
  PendingCheckInOp,
  PendingCheckOutOp,
  PendingNiyamSubmissionOp,
  PendingProofMedia,
  PendingShivirScanOp,
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
  /**
   * Domain payload the handler echoed back. The server has always sent this;
   * the type omitted it, so callers could not read the submission's real
   * status or its new_badges and every niyam submit reported "sent for review"
   * with no badge celebration, even when it was auto-approved.
   */
  data?: unknown;
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
    // H9 — the server dropped this op from `results` (e.g. its envelope could
    // not even be identified). This must still respect MAX_ATTEMPTS like
    // every other branch below, or an unidentifiable op spins forever instead
    // of eventually surfacing for a manual retry.
    const attempts = op.attempts + 1;
    if (!shouldRetry(attempts)) {
      return {
        ...op,
        state: "failed",
        attempts,
        last_error: {
          code: "ERR_NO_RESULT",
          message: "The server did not return a result for this item after several attempts.",
        },
      };
    }
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

/**
 * Niyam submission — drains via jp.queue.niyam_submissions.
 *
 * The queue key, drain slot and server handler all existed; only this producer
 * was missing, so `useSubmitNiyam` posted directly and a submission made out of
 * signal was lost outright — along with the proof the parent had just recorded.
 */
export async function enqueueNiyamSubmission(input: {
  niyam_id: string;
  student_id: string;
  media?: PendingProofMedia[];
  notes?: string;
  /** YYYY-MM-DD (IST). Today when omitted; the server allows yesterday too. */
  submission_date?: string;
}): Promise<string> {
  const submission_op_id = ulid();
  const client_timestamp = new Date().toISOString();
  const payload: PendingNiyamSubmissionOp = {
    submission_op_id,
    niyam_id: input.niyam_id,
    student_id: input.student_id,
    media: input.media,
    notes: input.notes,
    // Carried through so an op queued last night is recorded against the day
    // it was kept, not the day it happened to drain.
    submission_date: input.submission_date,
    client_timestamp,
  };
  await enqueueOp(QUEUE_KEYS.niyam_submissions, {
    submission_op_id,
    payload,
    state: "queued",
    attempts: 0,
    next_attempt_at: 0,
    created_at: client_timestamp,
  });
  return submission_op_id;
}

/**
 * Shivir QR scan — drains via jp.queue.shivir_scans.
 *
 * Shivir venues are exactly where signal fails, and AT28 makes these scans the
 * only record of that session's attendance: a discarded scan is unrecoverable.
 */
export async function enqueueShivirScan(input: {
  shivir_session_id: string;
  qr_payload: string;
  qr_signature: string;
  scan_kind?: "present" | "check_in" | "check_out";
  scanned_at?: string;
  /**
   * Caller-minted so the scanner screen can watch this specific op's state
   * (matching enqueueCheckIn/enqueueCheckOut). Without it a screen could queue a
   * scan and then have no way to say whether it synced.
   */
  submission_op_id?: string;
}): Promise<string> {
  const submission_op_id = input.submission_op_id ?? ulid();
  const client_timestamp = new Date().toISOString();
  const payload: PendingShivirScanOp = {
    submission_op_id,
    shivir_session_id: input.shivir_session_id,
    qr_payload: input.qr_payload,
    qr_signature: input.qr_signature,
    scan_kind: input.scan_kind,
    // The moment the card was scanned, not the moment it synced.
    scanned_at: input.scanned_at ?? client_timestamp,
    // AT19 per-item id. The server keys idempotency on this, so a queue drained
    // twice writes one row.
    client_op_id: ulid(),
    client_timestamp,
  };
  await enqueueOp(QUEUE_KEYS.shivir_scans, {
    submission_op_id,
    payload,
    state: "queued",
    attempts: 0,
    next_attempt_at: 0,
    created_at: client_timestamp,
  });
  return submission_op_id;
}

/** Rewrites one queued niyam op's media[] in place. */
async function patchNiyamMedia(
  submissionOpId: string,
  apply: (media: PendingProofMedia[]) => PendingProofMedia[],
): Promise<void> {
  const ops = await readQueue<PendingNiyamSubmissionOp>(QUEUE_KEYS.niyam_submissions);
  const idx = findOpIndex(ops, submissionOpId);
  if (idx < 0) return;
  const op = ops[idx]!;
  const media = op.payload.media ?? [];
  const next = apply(media);
  ops[idx] = { ...op, payload: { ...op.payload, media: next } };
  await writeQueue(QUEUE_KEYS.niyam_submissions, ops as QueuedOp[]);
}

/**
 * A queued proof finished uploading — write its URL onto the waiting submission
 * and clear `pending_upload` so planDrain can release the op.
 */
export async function resolveNiyamMediaUrl(input: {
  submission_op_id: string;
  media_upload_id: string;
  url: string;
  mime?: string;
  size_bytes?: number;
}): Promise<void> {
  await patchNiyamMedia(input.submission_op_id, (media) =>
    media.map((m) =>
      m.media_upload_id === input.media_upload_id
        ? {
            ...m,
            url: input.url,
            mime: input.mime ?? m.mime,
            size_bytes: input.size_bytes ?? m.size_bytes,
            pending_upload: false,
            local_uri: undefined,
          }
        : m,
    ),
  );
}

/**
 * A proof exhausted its upload attempts. Drop it so the submission still goes
 * with whatever landed — the same escape-hatch reasoning as a FAILED checkin
 * releasing attendance (AT8): one unsendable file must not strand the whole
 * submission. If the niyam required proof the server returns a terminal 422,
 * which surfaces in the six-state UI as `failed` with a manual retry.
 */
export async function dropNiyamMedia(input: {
  submission_op_id: string;
  media_upload_id: string;
}): Promise<void> {
  await patchNiyamMedia(input.submission_op_id, (media) =>
    media.filter((m) => m.media_upload_id !== input.media_upload_id),
  );
}

/**
 * Manual retry — never silently discard failed ops.
 *
 * `attempts` resets too. Leaving it at 10 meant a maxed-out op got exactly one
 * more shot per press and then went straight back to `failed` on the first
 * hiccup, so the retry button looked broken precisely when a volunteer needed
 * it. A person pressing Retry is new information about the world, not a
 * continuation of the automatic schedule.
 */
export async function retryOp(queue: QueueKey, submissionOpId: string): Promise<void> {
  const queues = await readAllQueues();
  const arr = queues[queue] ?? [];
  const idx = findOpIndex(arr, submissionOpId);
  if (idx < 0) return;
  arr[idx] = {
    ...arr[idx]!,
    state: "queued",
    attempts: 0,
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

/**
 * Server cap is 200 (syncBatchBodySchema); stay under it with headroom so a
 * single oversized post can never take the whole backlog down with it.
 */
export const MAX_OPS_PER_BATCH = 100;

/**
 * Which HTTP status should drive retry policy for a whole-batch transport failure.
 *
 * `ApiError` exposes `statusCode`, not `status` — reading the wrong property
 * yielded `undefined`, which `shouldRetry` treats as "network", so every 4xx was
 * retried ten times. Reading it correctly is necessary but NOT sufficient:
 * `shouldRetry` makes any 4xx terminal, so a 401 (access token expired while the
 * device was offline, refresh not yet run) would destroy the entire queue on the
 * first reconnect. An auth failure is transient by nature — the refresh flow
 * fixes it — so it is reported as retryable, not terminal.
 */
export function classifyTransportStatus(err: {
  status?: number;
  statusCode?: number;
}): number | undefined {
  const status = err.statusCode ?? err.status;
  if (status === 401 || status === 403) return undefined; // treat as transient — refresh then retry
  return status;
}

export async function drainQueues(): Promise<DrainOpResult[]> {
  if (draining) return [];
  draining = true;
  try {
    const queues = await readAllQueues();
    const dirty = new Set<QueueKey>();

    await requeueOrphanedSyncing(queues, dirty);
    if (dirty.size > 0) await flushDirtyQueues(queues, dirty);

    const plannedAll = planDrain(
      Object.fromEntries(
        DRAIN_ORDER.map((k) => [
          k,
          (queues[k] ?? []).filter((op) => op.state === "queued"),
        ]),
      ) as Record<QueueKey, QueuedOp[]>,
    );

    // The server caps /v1/sync/batch at 200 ops and answers an oversized body
    // with a flat 422. planDrain is uncapped, so a device offline for a week
    // would post its whole backlog and have EVERY op rejected together — and a
    // 422 is terminal (backoff.shouldRetry). Slice here; planDrain has already
    // ordered causally, so the remainder drains on the next tick in the same order.
    const planned = plannedAll.slice(0, MAX_OPS_PER_BATCH);

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
      const e = err as { status?: number; statusCode?: number; code?: string; message?: string };
      httpStatus = classifyTransportStatus(e);
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

/**
 * Is there any offline work outstanding?
 *
 * Used both to pace the sync loop and to decide whether the loop should run at
 * all. Counts anything not yet delivered — including ops waiting out a backoff
 * and ops orphaned mid-flight in `syncing` (which requeueOrphanedSyncing will
 * rescue on the next drain). A narrower "queued and due right now" reading would
 * report an idle device as having no work and let the loop stop before its
 * backlog cleared.
 *
 * Also counts the media-upload queue, which is not part of DRAIN_ORDER: a parent
 * with a stranded homework photo has real work pending even though no domain op
 * exists for it yet.
 */
export async function hasPendingSyncWork(): Promise<boolean> {
  const queues = await readAllQueues();
  const domainWork = DRAIN_ORDER.some((key) =>
    (queues[key] ?? []).some((op) => op.state === "queued" || op.state === "syncing"),
  );
  if (domainWork) return true;

  try {
    const { listMediaUploads } = await import("./media-upload-queue");
    const media = await listMediaUploads();
    return media.some((m) => m.state === "queued" || m.state === "uploading");
  } catch {
    return false;
  }
}

/** Start the periodic drain. Callers gate on hasPendingSyncWork, not on role. */
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

    // Cheap early-out so the loop is affordable for every role, not just the two
    // that used to be allow-listed (PERF #23). An idle device costs one read per
    // idle interval instead of a full media resume + drain.
    if (!(await hasPendingSyncWork())) {
      schedule(IDLE_INTERVAL_MS);
      return;
    }

    try {
      const { resumeProofMediaUploads } = await import("./media-upload-queue");
      await resumeProofMediaUploads();
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

