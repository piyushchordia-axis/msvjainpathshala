import { useCallback, useEffect, useState } from 'react';
import { get } from '@/lib/api-client';

type ListEnvelope<T> = {
  data?: { items?: T[] };
  meta?: { next_cursor?: string | null; has_more?: boolean };
};

function withCursor(path: string, cursor: string | null): string {
  if (!cursor) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}cursor=${encodeURIComponent(cursor)}`;
}

/**
 * Fetches an admin list endpoint and follows meta.next_cursor until exhausted
 * (keyset pagination — homework, and any future lists that adopt the same meta).
 */
export function useAdminList<T>(path: string, deps: unknown[] = []) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const collected: T[] = [];
      let cursor: string | null = null;
      let guard = 0;
      do {
        const envelope: ListEnvelope<T> = await get<ListEnvelope<T>>(withCursor(path, cursor));
        collected.push(...(envelope.data?.items ?? []));
        const next: string | null | undefined = envelope.meta?.next_cursor;
        cursor = typeof next === 'string' && next.length > 0 ? next : null;
        guard += 1;
      } while (cursor && guard < 50);
      setItems(collected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load data.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);

  return { items, loading, error, reload: load };
}
