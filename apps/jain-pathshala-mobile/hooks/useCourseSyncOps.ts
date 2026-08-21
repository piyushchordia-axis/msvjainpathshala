/**
 * Poll course offline queues for a student and expose UI sync states.
 * An op removed after a confirmed success flashes "synced" briefly, and one
 * removed after a confirmed duplicate flashes "already up to date" — never
 * inferred from the op merely disappearing (C5; CLAUDE.md failure table).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { QUEUE_KEYS, type QueueKey } from "@/lib/offline/queue-keys";
import { readQueue } from "@/lib/offline/storage";
import { getRecentDrainResult } from "@/lib/offline/sync-engine";
import type { SyncUiState, QueuedOp } from "@/lib/offline/types";

const SYNCED_HOLD_MS = 4000;
/** Slow cadence while no op is pending — just enough to notice new work. */
const IDLE_POLL_MS = 15000;

export type CourseSyncOpView = {
  submission_op_id: string;
  queue: QueueKey;
  state: SyncUiState;
  error?: { code: string; message: string };
  kind: "progress" | "certification";
};

type HeldSynced = CourseSyncOpView & { until: number };

export function useCourseSyncOps(opts: {
  studentId?: string;
  nodeId?: string;
  pollMs?: number;
}) {
  const [ops, setOps] = useState<CourseSyncOpView[]>([]);
  const known = useRef(new Map<string, CourseSyncOpView>());
  const heldSynced = useRef(new Map<string, HeldSynced>());
  /** Drives the poll cadence — fast only while an op is live. */
  const hasWork = useRef(false);
  const pollMs = opts.pollMs ?? 2000;

  const refresh = useCallback(async () => {
    const [progress, certs] = await Promise.all([
      readQueue(QUEUE_KEYS.course_progress),
      readQueue(QUEUE_KEYS.course_certification),
    ]);
    const now = Date.now();
    const liveIds = new Set<string>();
    const views: CourseSyncOpView[] = [];

    const consider = (
      op: QueuedOp,
      queue: QueueKey,
      kind: "progress" | "certification",
      matches: boolean,
    ) => {
      if (!matches) return;
      const view = toView(op, queue, kind);
      liveIds.add(op.submission_op_id);

      // L27 — `op.state` read directly from storage is never "duplicate":
      // applyDrainResult removes a duplicate op from storage just like a
      // successful one, so that outcome only ever reaches this hook through
      // the vanished-op branch below (via getRecentDrainResult), never here.
      if (op.state === "synced") {
        heldSynced.current.set(op.submission_op_id, {
          ...view,
          state: "synced",
          until: now + SYNCED_HOLD_MS,
        });
        known.current.delete(op.submission_op_id);
        return;
      }

      known.current.set(op.submission_op_id, view);
      heldSynced.current.delete(op.submission_op_id);
      views.push(view);
    };

    for (const op of progress) {
      const p = op.payload as {
        node_id?: string;
        marks?: Array<{ student_id: string }>;
      };
      const matches =
        (!opts.nodeId || p.node_id === opts.nodeId) &&
        (!opts.studentId ||
          (p.marks ?? []).some((m) => m.student_id === opts.studentId));
      consider(op, QUEUE_KEYS.course_progress, "progress", matches);
    }
    for (const op of certs) {
      const p = op.payload as { node_id?: string; student_id?: string };
      const matches =
        (!opts.nodeId || p.node_id === opts.nodeId) &&
        (!opts.studentId || p.student_id === opts.studentId);
      consider(op, QUEUE_KEYS.course_certification, "certification", matches);
    }

    // Ops that vanished after syncing — but "vanished" alone is never enough
    // to call it synced (C5). applyDrainResult removes an op from storage on
    // BOTH success and duplicate, and a corrupt read (storage.ts) or an
    // unrelated bug can also make an op disappear. Consult the recorded
    // outcome from the drain that actually removed it; anything without a
    // confirmed success/duplicate result is dropped from view, not reported
    // as saved.
    for (const [id, prev] of [...known.current.entries()]) {
      if (liveIds.has(id)) continue;
      if (prev.state === "syncing" || prev.state === "queued") {
        const recorded = getRecentDrainResult(id);
        if (recorded?.status === "success") {
          heldSynced.current.set(id, { ...prev, state: "synced", until: now + SYNCED_HOLD_MS });
        } else if (recorded?.status === "duplicate") {
          // M22 — a duplicate is "already up to date", never "synced".
          heldSynced.current.set(id, { ...prev, state: "duplicate", until: now + SYNCED_HOLD_MS });
        }
        // No recorded terminal result yet: say nothing rather than guess.
      }
      known.current.delete(id);
    }

    for (const [id, held] of [...heldSynced.current.entries()]) {
      if (held.until <= now) {
        heldSynced.current.delete(id);
        continue;
      }
      views.push({
        submission_op_id: held.submission_op_id,
        queue: held.queue,
        state: held.state,
        kind: held.kind,
      });
    }

    hasWork.current = views.length > 0;
    setOps(views);
  }, [opts.nodeId, opts.studentId]);

  // Poll fast only while something is actually in flight. This ran a fixed 2s
  // interval reading TWO queues from AsyncStorage for as long as the screen was
  // mounted — ~1,200 parses over a 20-minute session with an empty queue, on the
  // same thread as the Guruji's taps.
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

function toView(
  op: QueuedOp,
  queue: QueueKey,
  kind: "progress" | "certification",
): CourseSyncOpView {
  return {
    submission_op_id: op.submission_op_id,
    queue,
    state: op.state,
    error: op.last_error,
    kind,
  };
}
