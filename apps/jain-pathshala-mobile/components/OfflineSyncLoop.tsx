/**
 * Starts the offline drain loop for any signed-in user.
 *
 * This was previously allow-listed to shikshak/sanchalak on the premise that
 * "parents, students and guests never enqueue sync ops". That premise was wrong:
 * parents enqueue homework submissions, mark-done acknowledgements and proof
 * media, and city/state/super admins enqueue course certifications. Their ops got
 * a single opportunistic drain at write time and, if it failed, were never
 * retried — homework never reached the Guruji and certificates stranded.
 *
 * The PERF #23 concern (idle polling burning AsyncStorage round-trips) is now
 * handled where it belongs: startSyncLoop early-outs on hasPendingSyncWork, so an
 * idle device does one cheap read per idle interval regardless of role.
 */
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

export function OfflineSyncLoop() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user) return;

    let stop: (() => void) | undefined;
    void import("@/lib/offline/sync-engine").then(({ startSyncLoop }) => {
      stop = startSyncLoop();
    });
    return () => stop?.();
  }, [loading, user?.id]);

  return null;
}
