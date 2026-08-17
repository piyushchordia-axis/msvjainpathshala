/**
 * Local media upload queue for homework proofs.
 *
 * Files are uploaded via POST /v1/uploads when the device can reach the API;
 * the resulting URL is then attached via jp.queue.homework_submissions (FIX #5).
 * If upload fails (offline / 5xx), the local URI stays queued and drain retries
 * on the next sync loop — never a silent drop.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { rejectIfOverUploadLimit } from "@/lib/upload-size-guard";
import type { UploadFileInput, UploadResult } from "@/lib/api";
import type { DrainOpResult } from "./sync-engine";
import { MAX_ATTEMPTS, backoffDelayMs } from "./backoff";

export const MEDIA_UPLOAD_QUEUE_KEY = "jp.queue.media_uploads";

/** Folder accepted by POST /v1/uploads and resolveOwnedUpload(folderPrefix: "homework/"). */
export const HOMEWORK_UPLOAD_FOLDER = "homework";

export type HomeworkFollowUp = {
  type: "homework_submission";
  assignment_id: string;
  student_id: string;
  submission_id?: string;
};

export type HomeworkProofSyncState = "queued" | "synced" | "conflict" | "failed";

export type PendingMediaUpload = {
  id: string;
  uri: string;
  name: string;
  mime: string;
  folder: string;
  follow_up?: HomeworkFollowUp;
  state: "queued" | "uploading" | "failed";
  attempts: number;
  /** Epoch ms — earliest next try. Without this, failures re-uploaded every tick. */
  next_attempt_at?: number;
  last_error?: string;
  created_at: string;
  /** Set after a successful upload, before follow-up enqueue. */
  remote_url?: string;
};

export type MediaUploadDeps = {
  upload: (file: UploadFileInput, folder?: string) => Promise<UploadResult>;
  enqueueHomework: (input: {
    assignment_id: string;
    student_id: string;
    submission_id?: string;
    proof_asset_id?: string;
  }) => Promise<string>;
  drainSync?: () => Promise<DrainOpResult[]>;
};

async function readQueue(): Promise<PendingMediaUpload[]> {
  const raw = await AsyncStorage.getItem(MEDIA_UPLOAD_QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PendingMediaUpload[];
  } catch {
    return [];
  }
}

async function writeQueue(ops: PendingMediaUpload[]): Promise<void> {
  await AsyncStorage.setItem(MEDIA_UPLOAD_QUEUE_KEY, JSON.stringify(ops));
}

export async function clearMediaUploadQueue(): Promise<void> {
  await AsyncStorage.removeItem(MEDIA_UPLOAD_QUEUE_KEY);
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Legacy client typo — map onto the real uploads enum value. */
function resolveHomeworkFolder(folder: string): string {
  return folder === "homework-proof" ? HOMEWORK_UPLOAD_FOLDER : folder;
}

function syncStateFromResult(
  result: DrainOpResult | undefined,
): { sync_state: HomeworkProofSyncState; error_message?: string } {
  if (!result) return { sync_state: "queued" };
  if (result.status === "success" || result.status === "duplicate") {
    return { sync_state: "synced" };
  }
  if (result.status === "conflict") {
    return {
      sync_state: "conflict",
      error_message: result.error?.message,
    };
  }
  return {
    sync_state: "failed",
    error_message: result.error?.message,
  };
}

/**
 * Size-guard, enqueue a local file, then best-effort drain.
 * Returns `rejected` without touching the queue when the file is oversized.
 */
export async function enqueueHomeworkProofUpload(
  input: {
    uri: string;
    name: string;
    mime: string;
    sizeBytes: number | null | undefined;
    hi?: boolean;
    assignment_id: string;
    student_id: string;
    submission_id?: string;
    folder?: string;
  },
  deps: MediaUploadDeps,
): Promise<
  | { status: "rejected"; message: string }
  | {
      status: "queued";
      id: string;
      remote_url?: string;
      homework_op_id?: string;
      sync_state: HomeworkProofSyncState;
      error_message?: string;
    }
> {
  const over = rejectIfOverUploadLimit(input.sizeBytes, input.hi === true);
  if (over) {
    return { status: "rejected", message: over };
  }

  const id = newId();
  const op: PendingMediaUpload = {
    id,
    uri: input.uri,
    name: input.name,
    mime: input.mime,
    folder: resolveHomeworkFolder(input.folder ?? HOMEWORK_UPLOAD_FOLDER),
    follow_up: {
      type: "homework_submission",
      assignment_id: input.assignment_id,
      student_id: input.student_id,
      submission_id: input.submission_id,
    },
    state: "queued",
    attempts: 0,
    created_at: new Date().toISOString(),
  };

  const cur = await readQueue();
  cur.push(op);
  await writeQueue(cur);

  const drained = await drainMediaUploads(deps);
  const done = drained.completed.find((c) => c.id === id);
  if (done) {
    return {
      status: "queued",
      id,
      remote_url: done.remote_url,
      homework_op_id: done.homework_op_id,
      sync_state: done.sync_state,
      error_message: done.error_message,
    };
  }

  // Still sitting in the media queue (upload offline / in progress).
  const pending = (await listMediaUploads()).find((o) => o.id === id);
  return {
    status: "queued",
    id,
    remote_url: pending?.remote_url,
    sync_state: "queued",
    error_message: pending?.last_error,
  };
}

/**
 * Upload queued local files; on success attach homework via FIX #5 queue.
 * Safe to call on reconnect / sync loop.
 */
export async function drainMediaUploads(
  deps: MediaUploadDeps,
): Promise<{
  uploaded: number;
  attached: number;
  completed: Array<{
    id: string;
    remote_url: string;
    homework_op_id?: string;
    sync_state: HomeworkProofSyncState;
    error_message?: string;
  }>;
}> {
  const completed: Array<{
    id: string;
    remote_url: string;
    homework_op_id?: string;
    sync_state: HomeworkProofSyncState;
    error_message?: string;
  }> = [];
  let uploaded = 0;
  let attached = 0;

  let ops = await readQueue();

  // Rescue items orphaned mid-upload (app killed while "uploading"): without this
  // they are never selected again and sit invisible forever — the media-queue
  // equivalent of requeueOrphanedSyncing in the domain queue.
  const orphaned = ops.filter((o) => o.state === "uploading");
  if (orphaned.length > 0) {
    ops = ops.map((o) => (o.state === "uploading" ? { ...o, state: "queued" as const } : o));
    await writeQueue(ops);
  }

  for (const op of ops.filter((o) => o.state === "queued" || o.state === "failed")) {
    ops = await readQueue();
    const current = ops.find((o) => o.id === op.id);
    if (!current || (current.state !== "queued" && current.state !== "failed")) continue;

    // `attempts` was incremented but never read, so a permanently-rejecting file
    // re-uploaded on every drain tick forever. Respect the same ceiling and
    // backoff the domain queue uses.
    if (current.attempts >= MAX_ATTEMPTS) continue;
    if (current.next_attempt_at && current.next_attempt_at > Date.now()) continue;

    await writeQueue(
      ops.map((o) =>
        o.id === op.id ? { ...o, state: "uploading" as const, attempts: o.attempts + 1 } : o,
      ),
    );

    let remoteUrl = current.remote_url;
    try {
      if (!remoteUrl) {
        const folder = resolveHomeworkFolder(current.folder);
        const result = await deps.upload(
          { uri: current.uri, name: current.name, type: current.mime },
          folder,
        );
        remoteUrl = result.url;
        uploaded += 1;
      }

      let homework_op_id: string | undefined;
      let sync_state: HomeworkProofSyncState = "queued";
      let error_message: string | undefined;

      if (current.follow_up?.type === "homework_submission") {
        homework_op_id = await deps.enqueueHomework({
          assignment_id: current.follow_up.assignment_id,
          student_id: current.follow_up.student_id,
          submission_id: current.follow_up.submission_id,
          proof_asset_id: remoteUrl,
        });
        attached += 1;
        if (deps.drainSync) {
          const results = await deps.drainSync();
          const mine = results.find((r) => r.submission_op_id === homework_op_id);
          ({ sync_state, error_message } = syncStateFromResult(mine));
        }
      } else {
        // No follow-up — upload alone counts as done.
        sync_state = "synced";
      }

      const after = await readQueue();
      // Keep media on domain failure so the parent can retry; dequeue on success/conflict.
      if (sync_state === "failed") {
        await writeQueue(
          after.map((o) =>
            o.id === op.id
              ? {
                  ...o,
                  state: "failed" as const,
                  remote_url: remoteUrl,
                  last_error: error_message,
                }
              : o,
          ),
        );
      } else {
        await writeQueue(after.filter((o) => o.id !== op.id));
      }
      completed.push({
        id: op.id,
        remote_url: remoteUrl,
        homework_op_id,
        sync_state,
        error_message,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      const after = await readQueue();
      await writeQueue(
        after.map((o) =>
          o.id === op.id
            ? {
                ...o,
                state: "failed" as const,
                // Back off like the domain queue instead of hammering the same
                // file on every tick until the app is reinstalled.
                next_attempt_at: Date.now() + backoffDelayMs(o.attempts),
                last_error: message,
                remote_url: remoteUrl,
              }
            : o,
        ),
      );
    }
  }

  return { uploaded, attached, completed };
}

/** Test helper — peek queue contents. */
export async function listMediaUploads(): Promise<PendingMediaUpload[]> {
  return readQueue();
}

/** Resume pending homework media uploads (call from sync loop). */
export async function resumeHomeworkProofUploads(): Promise<void> {
  const { apiUpload } = await import("@/lib/api");
  const { enqueueHomeworkSubmission, drainQueues } = await import("./sync-engine");
  await drainMediaUploads({
    upload: apiUpload,
    enqueueHomework: enqueueHomeworkSubmission,
    drainSync: drainQueues,
  });
}
