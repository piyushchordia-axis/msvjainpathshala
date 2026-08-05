/**
 * Starts the offline drain loop only for Guruji / Sanchalak personas.
 * Parents, students, and guests never enqueue sync ops — polling their queues
 * wasted ~5,760 AsyncStorage round-trips per hour (PERF #23).
 */
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

const SYNC_ROLES = new Set(["shikshak", "sanchalak"]);

export function OfflineSyncLoop() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user || !SYNC_ROLES.has(user.role)) return;

    let stop: (() => void) | undefined;
    void import("@/lib/offline/sync-engine").then(({ startSyncLoop }) => {
      stop = startSyncLoop();
    });
    return () => stop?.();
  }, [loading, user?.role]);

  return null;
}
