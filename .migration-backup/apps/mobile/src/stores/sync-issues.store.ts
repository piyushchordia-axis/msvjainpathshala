/**
 * `useSyncIssuesStore` — tiny Zustand bus the batch drain pings when an op
 * needs UI attention:
 *
 *   - `pending_drained_count` — how many ops succeeded in the last drain
 *     cycle. The success toast reads + resets this on display.
 *   - `last_conflict` — payload for the conflict modal (server rejected a
 *     state transition, e.g. attendance for a cancelled session). The modal
 *     consumes + clears it.
 *   - `failed_count` — mirror of failedOpsStore.count() so the profile-tab
 *     indicator can re-render without a polling loop.
 */

import { create } from 'zustand';

export interface SyncConflict {
  client_op_id: string;
  op_kind: string;
  error_code: string;
  error_message: string;
  /** Source queue the op came from — used by the modal's "Retry" button to
   *  re-enqueue. */
  source_queue: 'attendance' | 'shivir_scans' | 'niyam_submissions' | 'acknowledgements';
}

interface State {
  pending_drained_count: number;
  last_conflict: SyncConflict | null;
  failed_count: number;
  bumpDrained(n: number): void;
  consumeDrainedToast(): number;
  reportConflict(c: SyncConflict): void;
  clearConflict(): void;
  setFailedCount(n: number): void;
}

export const useSyncIssuesStore = create<State>((set, get) => ({
  pending_drained_count: 0,
  last_conflict: null,
  failed_count: 0,
  bumpDrained: (n) => set((s) => ({ pending_drained_count: s.pending_drained_count + n })),
  consumeDrainedToast: (): number => {
    const n = get().pending_drained_count;
    set({ pending_drained_count: 0 });
    return n;
  },
  reportConflict: (c) => set({ last_conflict: c }),
  clearConflict: () => set({ last_conflict: null }),
  setFailedCount: (failed_count) => set({ failed_count }),
}));
