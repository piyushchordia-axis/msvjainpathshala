/**
 * Poll course offline queues for a student and expose UI sync states.
 * Ops removed after success still flash "synced" briefly (CLAUDE.md failure table).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { QUEUE_KEYS, type QueueKey } from "@/lib/offline/queue-keys";
import { readQueue } from "@/lib/offline/storage";
import type { SyncUiState, QueuedOp } from "@/lib/offline/types";

const SYNCED_HOLD_MS = 4000;

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

      if (op.state === "synced" || op.state === "duplicate") {
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

    // Ops that vanished after syncing → brief synced confirmation.
    for (const [id, prev] of [...known.current.entries()]) {
      if (liveIds.has(id)) continue;
      if (prev.state === "syncing" || prev.state === "queued") {
        heldSynced.current.set(id, {
          ...prev,
          state: "synced",
          until: now + SYNCED_HOLD_MS,
        });
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
        state: "synced",
        kind: held.kind,
      });
    }

    setOps(views);
  }, [opts.nodeId, opts.studentId]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, pollMs);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    return () => {
      clearInterval(id);
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
