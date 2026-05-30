/**
 * Generic queue store backed by MMKV.
 *
 * Layout per queue (e.g. `jp.queue.attendance`):
 *
 *   keys:           ULID-sorted list of pending op ids, JSON-encoded array
 *   op:<client_op_id>:  JSON-encoded PendingOp<T>
 *
 * Why a separate `keys` index instead of MMKV's `getAllKeys()`?
 * `getAllKeys()` returns unsorted entries; ULIDs are sortable, but we want
 * stable FIFO drain order without a sort on every read. The index also
 * lets us cap the queue size cheaply.
 *
 * Concurrency: MMKV reads/writes are synchronous and process-local —
 * there's no JS concurrency for two `enqueue()`s to race against. If we
 * ever multi-thread (worklets, etc), revisit this.
 */

import { ulid } from '@/lib/ulid';

import { getMmkv, type MMKVInstanceId } from '../../mmkv';

import type { PendingOp } from '../../types';

const KEYS_INDEX = '__keys';
const OP_PREFIX = 'op:';

export class QueueStore<TPayload> {
  constructor(private readonly mmkvId: MMKVInstanceId) {}

  private get mmkv() {
    return getMmkv(this.mmkvId);
  }

  enqueue(kind: string, payload: TPayload): PendingOp<TPayload> {
    const op: PendingOp<TPayload> = {
      client_op_id: ulid(),
      kind,
      created_at: new Date().toISOString(),
      attempts: 0,
      last_error: null,
      payload,
    };
    this.mmkv.set(OP_PREFIX + op.client_op_id, JSON.stringify(op));
    const keys = this.readKeys();
    keys.push(op.client_op_id);
    this.writeKeys(keys);
    return op;
  }

  dequeue(client_op_id: string): void {
    this.mmkv.delete(OP_PREFIX + client_op_id);
    this.writeKeys(this.readKeys().filter((k) => k !== client_op_id));
  }

  getAll(): PendingOp<TPayload>[] {
    const out: PendingOp<TPayload>[] = [];
    for (const key of this.readKeys()) {
      const raw = this.mmkv.getString(OP_PREFIX + key);
      if (!raw) continue;
      try {
        out.push(JSON.parse(raw) as PendingOp<TPayload>);
      } catch {
        // skip corrupt entry; drop it from the index so it doesn't haunt us
        this.dequeue(key);
      }
    }
    return out;
  }

  updateAttempt(client_op_id: string, error: string | null): void {
    const raw = this.mmkv.getString(OP_PREFIX + client_op_id);
    if (!raw) return;
    try {
      const op = JSON.parse(raw) as PendingOp<TPayload>;
      op.attempts += 1;
      op.last_error = error;
      this.mmkv.set(OP_PREFIX + client_op_id, JSON.stringify(op));
    } catch {
      this.dequeue(client_op_id);
    }
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
