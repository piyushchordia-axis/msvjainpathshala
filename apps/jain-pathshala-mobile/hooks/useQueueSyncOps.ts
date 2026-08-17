/**
 * Surface the real state of queued offline ops for any queue.
 *
 * Generalised from useCourseSyncOps, which was the only place in the app that
 * modelled CLAUDE.md's six-state failure table honestly. Everywhere else — the
 * attendance queue, check-out, parent homework — had no consumer at all, so a
 * server `conflict` (cancelled session, edit window expired) or a terminal
 * `failed` rendered as a green "Saved" forever, with no retry affordance.
 *
 * Two behaviours are load-bearing and easy to get wrong:
 *  - A successful op is REMOVED from storage by applyDrainResult, so "synced" can
 *    never be read from disk. It is synthesised when an op we were watching
 *    disappears, and held briefly so the confirmation is actually seen.
 *  - Polling is gated on there being ops to watch, so an idle screen is cheap.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { QueueKey } from "@/lib/offline/queue-keys";
import { readQueue } from "@/lib/offline/storage";
import type { SyncUiState, QueuedOp } from "@/lib/offline/types";

const SYNCED_HOLD_MS = 4000;
const DEFAULT_POLL_MS = 3000;
/** Slow cadence while nothing is in flight — just enough to notice new work. */
const IDLE_POLL_MS = 15000;

export type QueueSyncOpView = {
  submission_op_id: string;
  queue: QueueKey;
  state: SyncUiState;
  error?: { code: string; message: string };
};

type HeldSynced = QueueSyncOpView & { until: number };

/**
 * @param queues  which queues to watch
 * @param match   narrow to the ops this screen is responsible for (e.g. one
 *                session, one assignment). Return true to include the op.
 */
export function useQueueSyncOps(
  queues: QueueKey[],
  match?: (payload: unknown, queue: QueueKey) => boolean,
  opts?: { pollMs?: number },
) {
  const [ops, setOps] = useState<QueueSyncOpView[]>([]);
  const known = useRef(new Map<string, QueueSyncOpView>());
  const heldSynced = useRef(new Map<string, HeldSynced>());
  const hasWork = useRef(false);
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;

  // Stable across renders so callers can pass inline array/predicate literals
  // without restarting the interval on every render.
  const queuesKey = queues.join("|");
  const matchRef = useRef(match);
  matchRef.current = match;

  const refresh = useCallback(async () => {
    const queueList = queuesKey.split("|").filter(Boolean) as QueueKey[];
    const lists = await Promise.all(queueList.map((q) => readQueue(q)));
    const now = Date.now();
    const liveIds = new Set<string>();
    const views: QueueSyncOpView[] = [];

    lists.forEach((list, i) => {
      const queue = queueList[i]!;
      for (const op of list) {
        if (matchRef.current && !matchRef.current(op.payload, queue)) continue;
        const view: QueueSyncOpView = {
          submission_op_id: op.submission_op_id,
          queue,
          state: op.state,
          error: op.last_error,
        };
        liveIds.add(op.submission_op_id);

        if (op.state === "synced" || op.state === "duplicate") {
          heldSynced.current.set(op.submission_op_id, {
            ...view,
            state: "synced",
            until: now + SYNCED_HOLD_MS,
          });
          known.current.delete(op.submission_op_id);
          continue;
        }

        known.current.set(op.submission_op_id, view);
        heldSynced.current.delete(op.submission_op_id);
        views.push(view);
      }
    });

    // Watched op vanished → it drained successfully. Show a brief confirmation
    // rather than having the row silently revert to its resting state.
    for (const [id, prev] of [...known.current.entries()]) {
      if (liveIds.has(id)) continue;
      if (prev.state === "syncing" || prev.state === "queued") {
        heldSynced.current.set(id, { ...prev, state: "synced", until: now + SYNCED_HOLD_MS });
      }
      known.current.delete(id);
    }

    for (const [id, held] of [...heldSynced.current.entries()]) {
      if (held.until <= now) {
        heldSynced.current.delete(id);
        continue;
      }
      views.push({ submission_op_id: held.submission_op_id, queue: held.queue, state: "synced" });
    }

    hasWork.current = views.length > 0;
    setOps(views);
  }, [queuesKey]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      timer = setTimeout(() => void tick(), hasWork.current ? pollMs : IDLE_POLL_MS);
    };

    void tick();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [refresh, pollMs]);

  return { ops, refresh };
}

/** Convenience: the single most relevant op to show for a row. */
export function primarySyncOp(ops: QueueSyncOpView[]): QueueSyncOpView | null {
  if (ops.length === 0) return null;
  // Surface problems ahead of progress — a conflict must never hide behind a
  // "queued" badge for a different op on the same row.
  const rank: Record<SyncUiState, number> = {
    conflict: 0,
    failed: 1,
    syncing: 2,
    queued: 3,
    synced: 4,
    duplicate: 5,
  };
  return [...ops].sort((a, b) => rank[a.state] - rank[b.state])[0]!;
}
