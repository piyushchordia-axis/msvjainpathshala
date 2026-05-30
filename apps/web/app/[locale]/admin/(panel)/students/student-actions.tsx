'use client';

/**
 * Row action for the students roster: deactivate an active student or
 * reactivate an inactive one (Q11 — students are never hard-deleted). Posts to
 * /api/admin/students/:id/status, toasts the result, and refreshes the list.
 */

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { toast } from '@/components/ui/toast';

export function StudentActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isActive = status === 'active';
  const action = isActive ? 'deactivate' : 'reactivate';

  function run() {
    let reason: string | undefined;
    if (isActive) {
      const r = window.prompt('Reason for deactivating this student (required):')?.trim();
      if (!r) {
        toast.error('Deactivation cancelled', 'A reason is required.');
        return;
      }
      reason = r;
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/students/${id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
        });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) throw new Error(j?.error?.message ?? `Could not update (${res.status})`);
        toast.success(
          isActive ? 'Student deactivated' : 'Student reactivated',
          isActive
            ? 'They no longer appear in active rosters, attendance or leaderboards.'
            : 'They are active again.',
        );
        router.refresh();
      } catch (err) {
        toast.error('Could not update', err instanceof Error ? err.message : 'Unknown error');
      }
    });
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className={`text-xs font-medium hover:underline disabled:opacity-50 ${
        isActive ? 'text-destructive' : 'text-saffron'
      }`}
    >
      {pending ? '…' : isActive ? 'Deactivate' : 'Reactivate'}
    </button>
  );
}
