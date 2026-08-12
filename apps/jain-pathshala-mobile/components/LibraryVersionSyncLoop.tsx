/**
 * Cold-start library content-version sync (once per launch per auth scope).
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLibraryAudio } from "@/contexts/LibraryAudioContext";
import { runLibraryVersionSync } from "@/lib/library/run-version-sync";
import type { ManifestScope } from "@/lib/library/version-manifest";

export function LibraryVersionSyncLoop({ hydrated }: { hydrated: boolean }) {
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const { track, stop } = useLibraryAudio();
  const ran = useRef<Set<ManifestScope>>(new Set());
  const trackRef = useRef(track);
  trackRef.current = track;

  useEffect(() => {
    if (!hydrated || loading) return;
    const scope: ManifestScope = user ? "member" : "public";
    if (ran.current.has(scope)) return;
    ran.current.add(scope);

    void runLibraryVersionSync({
      queryClient: qc,
      scope,
      onPruneItem: (itemId) => {
        if (trackRef.current?.itemId === itemId) stop();
      },
    });
  }, [hydrated, loading, user, qc, stop]);

  return null;
}
