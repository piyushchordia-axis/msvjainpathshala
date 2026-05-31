'use client';

/**
 * Gallery row — client component that owns the feature/unfeature/remove
 * actions. Remove opens an inline reason prompt (≥ 20 chars).
 */

import { useState, useTransition } from 'react';

import type { AdminGalleryItem } from '@/api/niyams';

interface Props {
  row: AdminGalleryItem;
}

interface Result {
  ok: boolean;
  message: string;
}

export function GalleryRow({ row }: Props) {
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState<AdminGalleryItem>(row);
  const [showRemove, setShowRemove] = useState(false);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  function action(path: '/api/admin/gallery/feature' | '/api/admin/gallery/unfeature') {
    startTransition(async () => {
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: current.id }),
        });
        const body = await res.json();
        if (!res.ok) {
          setResult({ ok: false, message: body?.error?.message ?? `HTTP ${res.status}` });
          return;
        }
        setCurrent({ ...current, ...body.data });
        setResult({
          ok: true,
          message: path.endsWith('feature') ? 'Marked as featured' : 'Unfeatured',
        });
      } catch (err) {
        setResult({ ok: false, message: err instanceof Error ? err.message : 'Network error' });
      }
    });
  }

  function submitRemove() {
    if (reason.trim().length < 20) {
      setResult({ ok: false, message: 'Reason must be at least 20 characters.' });
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/gallery/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: current.id, reason: reason.trim() }),
        });
        const body = await res.json();
        if (!res.ok) {
          setResult({ ok: false, message: body?.error?.message ?? `HTTP ${res.status}` });
          return;
        }
        setCurrent({ ...current, ...body.data });
        setResult({ ok: true, message: 'Removed from gallery — parent notified' });
        setShowRemove(false);
        setReason('');
      } catch (err) {
        setResult({ ok: false, message: err instanceof Error ? err.message : 'Network error' });
      }
    });
  }

  return (
    <>
      <tr className="hover:bg-muted/30">
        <td className="px-4 py-3">
          <div className="font-medium text-foreground">{current.first_name}</div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {current.age_group}
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="text-foreground">{current.niyam_title_en}</div>
          <div className="text-xs text-muted-foreground">{current.niyam_title_hi}</div>
        </td>
        <td className="px-4 py-3">
          <StatusBadge item={current} />
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">
          {new Date(current.created_at).toLocaleString()}
        </td>
        <td className="px-4 py-3 text-right">
          <div className="inline-flex flex-wrap items-center justify-end gap-2">
            {current.removed ? (
              <span className="text-xs italic text-muted-foreground">Hidden</span>
            ) : current.is_featured ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => action('/api/admin/gallery/unfeature')}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/30"
              >
                Unfeature
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => action('/api/admin/gallery/feature')}
                className="rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
              >
                Feature
              </button>
            )}
            {!current.removed ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => setShowRemove((v) => !v)}
                className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10"
              >
                Remove
              </button>
            ) : null}
          </div>
        </td>
      </tr>

      {showRemove ? (
        <tr>
          <td colSpan={5} className="bg-muted/30 px-4 py-3">
            <div className="rounded-md border border-border bg-background p-4">
              <div className="mb-2 text-sm font-semibold text-foreground">
                Remove from gallery — parent will be notified
              </div>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                disabled={pending}
                placeholder="Reason (≥ 20 characters)"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowRemove(false);
                    setReason('');
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={submitRemove}
                  className="rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:bg-destructive/60"
                >
                  {pending ? 'Removing…' : 'Confirm remove'}
                </button>
              </div>
            </div>
          </td>
        </tr>
      ) : null}

      {result ? (
        <tr>
          <td colSpan={5} className="px-4 py-2">
            <div
              className={
                result.ok
                  ? 'rounded-md border border-success/30 bg-success/10 px-3 py-1.5 text-xs text-success'
                  : 'rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive'
              }
            >
              {result.message}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function StatusBadge({ item }: { item: AdminGalleryItem }) {
  if (item.removed) {
    return (
      <span className="rounded-pill bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-destructive">
        Removed
      </span>
    );
  }
  if (item.is_featured) {
    return (
      <span className="rounded-pill bg-gold/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gold">
        Featured
      </span>
    );
  }
  return (
    <span className="rounded-pill bg-success/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-success">
      Visible
    </span>
  );
}
