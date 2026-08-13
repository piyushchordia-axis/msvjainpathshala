/**
 * Local-only library item bookmarks (favorites). Independent of audio downloads.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const LIBRARY_BOOKMARKS_KEY = "jp.library.bookmarks";

let cache: Set<string> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Set<string> {
  return cache ?? EMPTY;
}

const EMPTY = new Set<string>();

async function persist(next: Set<string>): Promise<void> {
  cache = next;
  emit();
  await AsyncStorage.setItem(LIBRARY_BOOKMARKS_KEY, JSON.stringify([...next]));
}

export async function hydrateLibraryBookmarks(): Promise<void> {
  if (cache) return;
  try {
    const raw = await AsyncStorage.getItem(LIBRARY_BOOKMARKS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    cache = new Set();
  }
  emit();
}

export async function toggleLibraryBookmark(itemId: string): Promise<boolean> {
  if (!cache) await hydrateLibraryBookmarks();
  const next = new Set(cache ?? []);
  if (next.has(itemId)) next.delete(itemId);
  else next.add(itemId);
  await persist(next);
  return next.has(itemId);
}

export function useLibraryBookmarks() {
  useEffect(() => {
    void hydrateLibraryBookmarks();
  }, []);
  const ids = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const isBookmarked = useCallback((itemId: string) => ids.has(itemId), [ids]);
  const toggle = useCallback((itemId: string) => toggleLibraryBookmark(itemId), []);
  return { ids, isBookmarked, toggle };
}
