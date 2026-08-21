/**
 * Durable offline queues. Uses AsyncStorage with exact jp.queue.* keys.
 * (Spec names them MMKV keys; persistence semantics are what matter for relaunch.)
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DRAIN_ORDER, type QueueKey } from "./queue-keys";
import type { QueuedOp, PendingOpPayload } from "./types";

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) l();
}

export async function readQueue<T extends PendingOpPayload = PendingOpPayload>(
  key: QueueKey,
): Promise<QueuedOp<T>[]> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedOp<T>[];
  } catch (err) {
    // C5 — a corrupt payload must never silently read back as "nothing was
    // ever queued"; that is how a night's worth of offline stars disappear
    // with no trace. Quarantine the raw bytes under `<key>.corrupt` (moved,
    // not copied, so the next read doesn't keep re-hitting the same parse
    // failure) and log loudly instead of swallowing it.
    console.error(
      `[offline] Corrupt queue payload for "${key}" — quarantining instead of discarding.`,
      err,
    );
    try {
      await AsyncStorage.setItem(`${key}.corrupt`, raw);
      await AsyncStorage.removeItem(key);
    } catch (quarantineErr) {
      console.error(`[offline] Failed to quarantine corrupt payload for "${key}".`, quarantineErr);
    }
    return [];
  }
}

export async function writeQueue(key: QueueKey, ops: QueuedOp[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(ops));
  notify();
}

export async function enqueueOp<T extends PendingOpPayload>(
  key: QueueKey,
  op: QueuedOp<T>,
): Promise<void> {
  const cur = await readQueue(key);
  cur.push(op as QueuedOp);
  // Keep ULID lexicographic order (= creation order).
  cur.sort((a, b) => a.submission_op_id.localeCompare(b.submission_op_id));
  await writeQueue(key, cur);
}

export async function updateOp(
  key: QueueKey,
  submissionOpId: string,
  patch: Partial<QueuedOp>,
): Promise<void> {
  const cur = await readQueue(key);
  const next = cur.map((op) =>
    op.submission_op_id === submissionOpId ? { ...op, ...patch } : op,
  );
  await writeQueue(key, next);
}

export async function removeOp(key: QueueKey, submissionOpId: string): Promise<void> {
  const cur = await readQueue(key);
  await writeQueue(
    key,
    cur.filter((op) => op.submission_op_id !== submissionOpId),
  );
}

export async function readAllQueues(): Promise<Record<QueueKey, QueuedOp[]>> {
  const out = {} as Record<QueueKey, QueuedOp[]>;
  for (const key of DRAIN_ORDER) {
    out[key] = await readQueue(key);
  }
  return out;
}

/** Test helper — wipe all offline queues. */
export async function clearAllQueues(): Promise<void> {
  await AsyncStorage.multiRemove([...DRAIN_ORDER]);
  notify();
}
