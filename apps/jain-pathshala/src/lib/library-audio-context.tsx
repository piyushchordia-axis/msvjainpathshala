/**
 * One audio element for the whole web library.
 *
 * Two defects made this necessary. Each item row used to build its own
 * `new Audio(...)`, so two stavans could sing over each other. And the guard
 * that was meant to reuse an element compared `el.src` against the URL it was
 * constructed from:
 *
 *     if (!playerRef.current || playerRef.current.src !== audio) { ... }
 *
 * `HTMLMediaElement.src` reflects the RESOLVED absolute URL, while `audio` is
 * the relative signed path the API returned. They are never equal, so every
 * press built a fresh element: playback restarted from 0:00 and the file was
 * downloaded again. Identity belongs to the item, not to a string the DOM is
 * free to rewrite — so the comparison here is on `itemId`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "@/components/ui/toast-jp";
import { useLocale } from "@/lib/locale-context";

export type LibraryTrack = {
  itemId: string;
  /** Resolved by the caller via safeHref — may be relative. */
  src: string;
  title: string;
};

interface LibraryAudioValue {
  currentItemId: string | null;
  playing: boolean;
  /** Seconds. 0 when nothing is loaded. */
  position: number;
  /** Seconds, or the item's declared duration before metadata arrives. */
  duration: number;
  toggle: (track: LibraryTrack, fallbackDurationSec?: number | null) => void;
  seek: (seconds: number) => void;
}

const LibraryAudioContext = createContext<LibraryAudioValue>({
  currentItemId: null,
  playing: false,
  position: 0,
  duration: 0,
  toggle: () => {},
  seek: () => {},
});

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LibraryAudioProvider({ children }: { children: ReactNode }) {
  const hi = useLocale() === "hi";
  const elRef = useRef<HTMLAudioElement | null>(null);
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [declaredDuration, setDeclaredDuration] = useState(0);

  function element(): HTMLAudioElement {
    if (elRef.current) return elRef.current;
    const el = new Audio();
    el.preload = "metadata";
    el.addEventListener("play", () => setPlaying(true));
    el.addEventListener("pause", () => setPlaying(false));
    el.addEventListener("ended", () => {
      setPlaying(false);
      setPosition(0);
    });
    el.addEventListener("timeupdate", () => setPosition(el.currentTime));
    el.addEventListener("loadedmetadata", () => {
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    });
    elRef.current = el;
    return el;
  }

  useEffect(() => {
    return () => {
      elRef.current?.pause();
      elRef.current = null;
    };
  }, []);

  const toggle = useCallback(
    (track: LibraryTrack, fallbackDurationSec?: number | null) => {
      const el = element();

      // Same item: resume where it was. This is the whole point of the module.
      if (currentItemId === track.itemId) {
        if (el.paused) {
          void el.play().catch(() => reportPlaybackFailure(hi));
        } else {
          el.pause();
        }
        return;
      }

      // Different item: one element means starting this one stops the other,
      // rather than two readings playing over each other.
      el.pause();
      el.src = track.src;
      setCurrentItemId(track.itemId);
      setPosition(0);
      setDeclaredDuration(fallbackDurationSec ?? 0);
      setDuration(0);
      void el.play().catch(() => reportPlaybackFailure(hi));
    },
    [currentItemId, hi],
  );

  const seek = useCallback((seconds: number) => {
    const el = elRef.current;
    if (!el) return;
    el.currentTime = seconds;
    setPosition(seconds);
  }, []);

  const value = useMemo<LibraryAudioValue>(
    () => ({
      currentItemId,
      playing,
      position,
      // `audio_duration_sec` is on the DTO and lets the scrubber be usable
      // before metadata lands, instead of a dead 0-width track.
      duration: duration || declaredDuration,
      toggle,
      seek,
    }),
    [currentItemId, playing, position, duration, declaredDuration, toggle, seek],
  );

  return (
    <LibraryAudioContext.Provider value={value}>{children}</LibraryAudioContext.Provider>
  );
}

function reportPlaybackFailure(hi: boolean) {
  toast.error(
    hi ? 'ऑडियो नहीं चला' : 'Could not play audio',
    hi
      ? 'लिंक समाप्त हो सकता है — पेज रिफ़्रेश करके फिर कोशिश करें।'
      : 'The link may have expired — refresh the page and try again.',
  );
}

export function useLibraryAudio(): LibraryAudioValue {
  return useContext(LibraryAudioContext);
}
