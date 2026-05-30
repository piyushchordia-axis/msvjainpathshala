'use client';

/**
 * Row action for the batches list: deactivate an active batch.
 */

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { toast } from '@/components/ui/toast';

export function BatchActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (status !== 'active') {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  function run() {
    if (!window.confirm('Deactivate this batch?')) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/batches/${id}/deactivate`, { method: 'POST' });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) throw new Error(j?.error?.message ?? `Could not deactivate (${res.status})`);
        toast.success('Batch deactivated', 'It no longer appears in active rosters.');
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
