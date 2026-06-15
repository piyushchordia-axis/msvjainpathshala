import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';

export function useAdminList<T>(path: string, deps: unknown[] = []) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: T[] }>(path);
      setItems(res?.items ?? []);
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
