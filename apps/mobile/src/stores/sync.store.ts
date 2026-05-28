/**
 * useSyncStatus — Zustand store the sync engine publishes to.
 *
 * Status state machine:
 *   `offline`   — NetInfo says we're not online
 *   `idle`      — online, nothing pending
 *   `syncing`   — drain cycle in progress
 *   `error`     — last cycle had retryable failures (sync engine will retry)
 *
 * `pending_count` is the rough sum across all four queues at the last sample.
 * It's not realtime — enqueues from feature steps will need to bump it
 * locally for instant feedback.
 */

import { create } from 'zustand';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

interface SyncState {
  status: SyncStatus;
  last_sync_at: string | null;
  last_error: string | null;
  pending_count: number;
  setStatus(s: SyncStatus): void;
  setLastSync(at: string): void;
  setLastError(msg: string | null): void;
  setPendingCount(n: number): void;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: 'idle',
  last_sync_at: null,
  last_error: null,
  pending_count: 0,
  setStatus: (status) => set({ status }),
  setLastSync: (at) => set({ last_sync_at: at, last_error: null }),
  setLastError: (msg) => set({ last_error: msg, status: msg ? 'error' : 'idle' }),
  setPendingCount: (pending_count) => set({ pending_count }),
}));
