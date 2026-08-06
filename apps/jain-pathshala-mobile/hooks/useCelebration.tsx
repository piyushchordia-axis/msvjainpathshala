import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { CelebrationBurst } from "@/components/CelebrationBurst";

type FireOpts = {
  /** Optional bilingual title shown with the burst. */
  message?: string;
};

/**
 * Mount `{Celebration}` once near the screen root; call `fire()` on submit success.
 * Ignores re-entry while a burst is already playing.
 */
export function useCelebration(): {
  fire: (opts?: FireOpts) => void;
  Celebration: ReactElement | null;
} {
  const [burst, setBurst] = useState<{ key: number; message?: string } | null>(null);
  const busy = useRef(false);

  const fire = useCallback((opts?: FireOpts) => {
    if (busy.current) return;
    busy.current = true;
    if (Platform.OS !== "web") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setBurst({ key: Date.now(), message: opts?.message });
  }, []);

  const onComplete = useCallback(() => {
    busy.current = false;
    setBurst(null);
  }, []);

  const Celebration = useMemo(() => {
    if (!burst) return null;
    return (
      <CelebrationBurst
        key={burst.key}
        message={burst.message}
        onComplete={onComplete}
      />
    );
  }, [burst, onComplete]);

  return { fire, Celebration };
}
