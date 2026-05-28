/**
 * Failed-ops MMKV store — ops that the server has REJECTED with a
 * non-retryable error code. They live here until the user resolves them
 * in the "Sync issues" drawer (Retry → re-enqueue to source / Discard
 * → delete forever).
 *
 * Unlike the per-feature queue stores, this one isn't drained by the
 * sync engine; the engine only WRITES here, and the UI READS + clears.
 */

import { getMmkv } from '../../mmkv';

import type { PendingOp } from '../../types';

const KEYS_INDEX = '__keys';
const OP_PREFIX = 'failed:';

export type FailedQueueName =
  | 'attendance'
  | 'shivir_scans'
  | 'niyam_submissions'
  | 'acknowledgements';

export interface FailedOp {
  client_op_id: string;
  source_queue: FailedQueueName;
  /** Original op_kind sent to the server (e.g. `attendance.mark`). */
  op_kind: string;
  failed_at: string;
  error_code: string;
  error_message: string;
  /** Verbatim original PendingOp so Retry can re-enqueue without re-deriving
   *  anything. Stored as a JSON-stringified blob. */
  pending_op: PendingOp<unknown>;
}

class FailedOpsStore {
  private get mmkv() {
    return getMmkv('jp.queue.failed_ops');
  }

  record(input: Omit<FailedOp, 'failed_at'>): FailedOp {
    const entry: FailedOp = { ...input, failed_at: new Date().toISOString() };
    this.mmkv.set(OP_PREFIX + entry.client_op_id, JSON.stringify(entry));
    const keys = this.readKeys();
    if (!keys.includes(entry.client_op_id)) {
      keys.push(entry.client_op_id);
      this.writeKeys(keys);
    }
    return entry;
  }

  getAll(): FailedOp[] {
    const out: FailedOp[] = [];
    for (const key of this.readKeys()) {
      const raw = this.mmkv.getString(OP_PREFIX + key);
      if (!raw) continue;
      try {
        out.push(JSON.parse(raw) as FailedOp);
      } catch {
        this.discard(key);
      }
    }
    return out;
  }

  /** Remove without re-enqueueing — Discard button. */
  discard(client_op_id: string): void {
    this.mmkv.delete(OP_PREFIX + client_op_id);
    this.writeKeys(this.readKeys().filter((k) => k !== client_op_id));
  }

  count(): number {
    return this.readKeys().length;
  }

  clear(): void {
    this.mmkv.clearAll();
  }

  private readKeys(): string[] {
    const raw = this.mmkv.getString(KEYS_INDEX);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }

  private writeKeys(keys: string[]): void {
    this.mmkv.set(KEYS_INDEX, JSON.stringify(keys));
  }
}

export const failedOpsStore = new FailedOpsStore();
