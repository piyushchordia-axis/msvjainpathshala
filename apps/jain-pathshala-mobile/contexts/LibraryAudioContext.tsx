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
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from "expo-audio";
import type { LibraryItemDto } from "@workspace/api-zod";

export type PlaybackSpeed = 0.75 | 1 | 1.25 | 1.5;

export type LibraryAudioTrack = {
  itemId: string;
  title_en: string;
  title_hi: string;
  title_gu: string;
  localUri: string;
};

type LibraryAudioContextValue = {
  track: LibraryAudioTrack | null;
  loaded: boolean;
  playing: boolean;
  position: number;
  duration: number;
  rate: PlaybackSpeed;
  fullPlayerOpen: boolean;
  setFullPlayerOpen: (open: boolean) => void;
  playItem: (item: LibraryItemDto, localUri: string) => Promise<void>;
  playTrack: (track: LibraryAudioTrack) => Promise<void>;
  togglePlayPause: () => void;
  seekTo: (seconds: number) => Promise<void>;
  setSpeed: (rate: PlaybackSpeed) => void;
  stop: () => void;
};

const LibraryAudioContext = createContext<LibraryAudioContextValue | null>(null);

const SPEEDS: PlaybackSpeed[] = [0.75, 1, 1.25, 1.5];

async function ensurePlaybackMode() {
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: "doNotMix",
    interruptionModeAndroid: "doNotMix",
  });
}

export function LibraryAudioProvider({ children }: { children: ReactNode }) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const [track, setTrack] = useState<LibraryAudioTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState<PlaybackSpeed>(1);
  const [loaded, setLoaded] = useState(false);
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      setPlaying(!!p.playing);
      setPosition(p.currentTime || 0);
      setDuration(p.duration || 0);
    }, 250);
    return () => {
      clearInterval(id);
      try {
        playerRef.current?.clearLockScreenControls();
        playerRef.current?.remove();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, []);

  const activateLockScreen = useCallback((title: string) => {
    const p = playerRef.current;
    if (!p) return;
    try {
      p.setActiveForLockScreen(
        true,
        { title, artist: "Jain Pathshala" },
        { showSeekForward: true, showSeekBackward: true },
      );
    } catch {
      /* lock screen unsupported on some platforms */
    }
  }, []);

  const playTrack = useCallback(
    async (next: LibraryAudioTrack) => {
      await ensurePlaybackMode();
      const existing = playerRef.current;
      if (existing) {
        try {
          existing.pause();
          existing.clearLockScreenControls();
          existing.remove();
        } catch {
          /* ignore */
        }
        playerRef.current = null;
      }
      try {
        const player = createAudioPlayer({ uri: next.localUri }, { updateInterval: 250 });
        playerRef.current = player;
        setTrack(next);
        setLoaded(true);
        setFullPlayerOpen(true);
        setRate(1);
        try {
          player.setPlaybackRate(1);
        } catch {
          player.playbackRate = 1;
        }
        player.play();
        setPlaying(true);
        const title = next.title_en || next.title_hi || next.title_gu || "Audio";
        setTimeout(() => activateLockScreen(title), 200);
      } catch {
        setTrack(null);
        setLoaded(false);
        setPlaying(false);
        setFullPlayerOpen(false);
      }
    },
    [activateLockScreen],
  );

  const playItem = useCallback(
    async (item: LibraryItemDto, localUri: string) => {
      await playTrack({
        itemId: item.id,
        title_en: item.title_en ?? "",
        title_hi: item.title_hi ?? "",
        title_gu: item.title_gu ?? "",
        localUri,
      });
    },
    [playTrack],
  );

  const togglePlayPause = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.playing) {
      p.pause();
      setPlaying(false);
    } else {
      void ensurePlaybackMode().then(() => {
        p.play();
        setPlaying(true);
        if (track) {
          activateLockScreen(track.title_en || track.title_hi || track.title_gu || "Audio");
        }
      });
    }
  }, [track, activateLockScreen]);

  const seekTo = useCallback(async (seconds: number) => {
    const p = playerRef.current;
    if (!p) return;
    await p.seekTo(Math.max(0, seconds));
    setPosition(seconds);
  }, []);

  const setSpeed = useCallback((next: PlaybackSpeed) => {
    const p = playerRef.current;
    if (!p) return;
    setRate(next);
    try {
      p.setPlaybackRate(next);
    } catch {
      p.playbackRate = next;
    }
  }, []);

  const stop = useCallback(() => {
    const p = playerRef.current;
    if (p) {
      try {
        p.pause();
        p.clearLockScreenControls();
        p.remove();
      } catch {
        /* ignore */
      }
    }
    playerRef.current = null;
    setTrack(null);
    setLoaded(false);
    setPlaying(false);
    setPosition(0);
    setDuration(0);
    setFullPlayerOpen(false);
  }, []);

  const value = useMemo<LibraryAudioContextValue>(
    () => ({
      track,
      loaded,
      playing,
      position,
      duration,
      rate,
      fullPlayerOpen,
      setFullPlayerOpen,
      playItem,
      playTrack,
      togglePlayPause,
      seekTo,
      setSpeed,
      stop,
    }),
    [
      track,
      loaded,
      playing,
      position,
      duration,
      rate,
      fullPlayerOpen,
      playItem,
      playTrack,
      togglePlayPause,
      seekTo,
      setSpeed,
      stop,
    ],
  );

  return (
    <LibraryAudioContext.Provider value={value}>{children}</LibraryAudioContext.Provider>
  );
}

export function useLibraryAudio(): LibraryAudioContextValue {
  const ctx = useContext(LibraryAudioContext);
  if (!ctx) {
    throw new Error("useLibraryAudio must be used within LibraryAudioProvider");
  }
  return ctx;
}

export { SPEEDS };
