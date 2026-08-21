/**
 * Session "view" state — which child a parent (or student) is currently
 * looking at. Parents have several children and can switch between them; a
 * student has exactly one record. Both personas read the active child from
 * here so home / niyams / punya screens stay in sync.
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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/contexts/AuthContext";
import { useChildren } from "@/lib/queries";
import type { ChildRow } from "@/lib/types";

interface SessionViewValue {
  children: ChildRow[];
  loading: boolean;
  isError: boolean;
  activeStudentId: string | null;
  activeChild: ChildRow | null;
  setActiveStudentId: (id: string) => void;
  refetch: () => void;
}

const SessionViewContext = createContext<SessionViewValue>({
  children: [],
  loading: false,
  isError: false,
  activeStudentId: null,
  activeChild: null,
  setActiveStudentId: () => {},
  refetch: () => {},
});

/** Per-user so a shared handset never restores another account's child. */
function activeChildKey(userId: string): string {
  return `jp.mobile.active_student.${userId}`;
}

export function SessionViewProvider({ children: node }: { children: ReactNode }) {
  const { user } = useAuth();
  const enabled = user?.role === "parent" || user?.role === "student";
  const { data, isLoading, isError, refetch } = useChildren(enabled);
  const rows = data?.items ?? [];

  const [activeStudentId, setActiveStudentIdState] = useState<string | null>(null);

  // The child last chosen on this device, once read back from storage. Held in
  // a ref because it only ever seeds the initial choice — it must not fight a
  // deliberate switch the parent makes later in the session.
  const restoredRef = useRef<string | null>(null);
  const [restoredTick, setRestoredTick] = useState(0);
  const storageKey = user?.id && enabled ? activeChildKey(user.id) : null;

  // Hard-reset the active selection whenever the signed-in user changes (or
  // when this provider is disabled for the current role), so a previous
  // account's child can never leak across a re-login on the same device, then
  // restore that user's own last choice.
  useEffect(() => {
    restoredRef.current = null;
    setActiveStudentIdState(null);
    if (!storageKey) return;
    let cancelled = false;
    AsyncStorage.getItem(storageKey)
      .then((saved) => {
        if (cancelled || !saved) return;
        restoredRef.current = saved;
        setRestoredTick((n) => n + 1);
      })
      .catch(() => {
        // Storage unavailable — fall back to "first child", as before.
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  // Seed from the restored child once the list loads; fall back to the first.
  // Selecting child #2, starting their exam and then killing the app used to
  // land back on child #1 with no resumable attempt in sight, which reads as
  // "the attempt was lost".
  useEffect(() => {
    if (rows.length === 0) {
      setActiveStudentIdState(null);
      return;
    }
    setActiveStudentIdState((prev) => {
      if (prev && rows.some((r) => r.id === prev)) return prev;
      const saved = restoredRef.current;
      if (saved && rows.some((r) => r.id === saved)) return saved;
      return rows[0].id;
    });
  }, [rows, restoredTick]);

  const setActiveStudentId = useCallback(
    (id: string) => {
      setActiveStudentIdState(id);
      restoredRef.current = id;
      if (storageKey) {
        AsyncStorage.setItem(storageKey, id).catch(() => {
          // A failed write only costs the restore on next launch.
        });
      }
    },
    [storageKey],
  );

  const value = useMemo<SessionViewValue>(() => {
    const activeChild = rows.find((r) => r.id === activeStudentId) ?? null;
    return {
      children: rows,
      loading: enabled && isLoading,
      isError,
      activeStudentId,
      activeChild,
      setActiveStudentId,
      refetch,
    };
  }, [rows, enabled, isLoading, isError, activeStudentId, setActiveStudentId, refetch]);

  return <SessionViewContext.Provider value={value}>{node}</SessionViewContext.Provider>;
}

export function useSessionView() {
  return useContext(SessionViewContext);
}
