import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from '@/lib/api-client';

type ListEnvelope<T> = {
  data?: { items?: T[]; next_cursor?: string | null };
  meta?: { next_cursor?: string | null; has_more?: boolean };
};

/**
 * `next_cursor` sits in `meta` on some list endpoints (gallery, homework) and in
 * `data` on others (admin students, audit logs, niyam submissions). This hook
 * read only `meta`, so every list backed by a `data`-style endpoint reported
 * hasMore=false and its "Load more" button never rendered — the pagination was
 * wired end-to-end but silently inert. Accept both rather than churn the routes.
 */
function readNextCursor<T>(envelope: ListEnvelope<T>): string | null {
  const candidate = envelope.data?.next_cursor ?? envelope.meta?.next_cursor;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function withCursor(path: string, cursor: string | null): string {
  if (!cursor) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}cursor=${encodeURIComponent(cursor)}`;
}

export type UseAdminListResult<T> = {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
};

/**
 * Fetches one page of an admin list. Call loadMore for the next cursor page.
 * Never auto-paginates (PERF #21 — was up to 50 sequential requests).
 */
export function useAdminList<T>(path: string, deps: unknown[] = []): UseAdminListResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(
    async (cursor: string | null, mode: 'replace' | 'append') => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      if (mode === 'replace') {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }

      try {
        const envelope = await get<ListEnvelope<T>>(withCursor(path, cursor), {
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        const page = envelope.data?.items ?? [];
        const next = readNextCursor(envelope);
        setItems((prev) => (mode === 'append' ? [...prev, ...page] : page));
        setNextCursor(next);
      } catch (err) {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Could not load data.');
        if (mode === 'replace') setItems([]);
        setNextCursor(null);
      } finally {
        if (!ac.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [path],
  );

  const reload = useCallback(async () => {
    await fetchPage(null, 'replace');
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || loading) return;
    await fetchPage(nextCursor, 'append');
  }, [fetchPage, nextCursor, loadingMore, loading]);

  useEffect(() => {
    void fetchPage(null, 'replace');
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage, ...deps]);

  return {
    items,
    loading,
    loadingMore,
    error,
    hasMore: nextCursor != null,
    reload,
    loadMore,
  };
}
