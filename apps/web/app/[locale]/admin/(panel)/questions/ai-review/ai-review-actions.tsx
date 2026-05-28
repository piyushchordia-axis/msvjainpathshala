/**
 * Client subcomponent — Approve / Reject buttons for a single AI question.
 *
 * Calls POST /api/admin/questions/review with the decision; on success
 * triggers a router.refresh() so the parent SC re-fetches and the row
 * either disappears (approved) or stays visible with the rejected banner.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

export default function AiReviewActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (decision: 'approve' | 'reject') => {
      setBusy(decision);
      setError(null);
      try {
        const res = await fetch('/api/admin/questions/review', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, decision }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          throw new Error(payload.error?.message ?? `Failed (${res.status})`);
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save');
      } finally {
        setBusy(null);
      }
    },
    [id, router],
  );

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void run('approve')}
          disabled={busy !== null}
          className="rounded-md bg-success px-4 py-2 text-sm font-semibold text-white hover:bg-success/90 disabled:opacity-60"
        >
          {busy === 'approve' ? 'Saving…' : 'Approve'}
        </button>
        <button
          type="button"
          onClick={() => void run('reject')}
          disabled={busy !== null}
          className="rounded-md bg-error px-4 py-2 text-sm font-semibold text-white hover:bg-error/90 disabled:opacity-60"
        >
          {busy === 'reject' ? 'Saving…' : 'Reject'}
        </button>
      </div>
      {error ? <div className="text-xs text-destructive">{error}</div> : null}
    </div>
  );
}
