/**
 * Session "view" state — which child a parent (or student) is currently
 * looking at. Parents have several children and can switch between them; a
 * student has exactly one record. Both personas read the active child from
 * here so home / niyams / punya screens stay in sync.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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

export function SessionViewProvider({ children: node }: { children: ReactNode }) {
  const { user } = useAuth();
  const enabled = user?.role === "parent" || user?.role === "student";
  const { data, isLoading, isError, refetch } = useChildren(enabled);
  const rows = data?.items ?? [];

  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);

  // Hard-reset the active selection whenever the signed-in user changes (or
  // when this provider is disabled for the current role), so a previous
  // account's child can never leak across a re-login on the same device.
  useEffect(() => {
    setActiveStudentId(null);
  }, [user?.id, enabled]);

  // Default to the first child once the list loads (or when it changes).
  useEffect(() => {
    if (rows.length === 0) {
      setActiveStudentId(null);
      return;
    }
    setActiveStudentId((prev) =>
      prev && rows.some((r) => r.id === prev) ? prev : rows[0].id,
    );
  }, [rows]);

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
  }, [rows, enabled, isLoading, isError, activeStudentId, refetch]);

  return <SessionViewContext.Provider value={value}>{node}</SessionViewContext.Provider>;
}

export function useSessionView() {
  return useContext(SessionViewContext);
}
