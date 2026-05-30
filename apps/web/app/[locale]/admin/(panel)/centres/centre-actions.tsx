'use client';

/**
 * Row action for the centres list: deactivate an active centre (rejected by
 * the backend if it still has active batches). Centres are never hard-deleted.
 */

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { toast } from '@/components/ui/toast';

export function CentreActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (status !== 'active') {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  function run() {
    if (!window.confirm('Deactivate this centre? It must have no active batches.')) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/centres/${id}/deactivate`, { method: 'POST' });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) throw new Error(j?.error?.message ?? `Could not deactivate (${res.status})`);
        toast.success('Centre deactivated', 'It no longer accepts new batches or enrolments.');
        router.refresh();
      } catch (err) {
        toast.error('Could not deactivate', err instanceof Error ? err.message : 'Unknown error');
      }
    });
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className="text-xs font-medium text-destructive hover:underline disabled:opacity-50"
    >
      {pending ? '…' : 'Deactivate'}
    </button>
  );
}
