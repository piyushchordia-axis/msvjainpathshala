/**
 * Debounced server-side picker search (GST-PRF-03).
 *
 * The join pickers load one clamped page of /v1/public/cities|centres and
 * filtered it client-side — on a network larger than the clamp, a centre
 * beyond the first page simply could not be chosen. Typing now also queries
 * the server's `?q=` and merges the hits into the local list.
 */
import { useEffect, useRef, useState } from 'react';
import { apiGet } from '@/lib/api-client';

/** Fetches `{items}` from `url` 300ms after it stops changing; null disables. */
export function usePickerSearch<T extends { id: string }>(url: string | null): T[] {
  const [items, setItems] = useState<T[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    if (!url) {
      setItems([]);
      return;
    }
    const mySeq = ++seq.current;
    const t = setTimeout(() => {
      apiGet<{ items: T[] }>(url)
        .then((res) => {
          if (seq.current === mySeq) setItems(res.items ?? []);
        })
        .catch(() => {
          // Keep the base list working — search extras are best-effort.
        });
    }, 300);
    return () => clearTimeout(t);
  }, [url]);

  return items;
}

export function mergeById<T extends { id: string }>(base: T[], extra: T[]): T[] {
  if (extra.length === 0) return base;
  const seen = new Set(base.map((x) => x.id));
  const merged = [...base];
  for (const item of extra) {
    if (!seen.has(item.id)) merged.push(item);
  }
  return merged;
}
