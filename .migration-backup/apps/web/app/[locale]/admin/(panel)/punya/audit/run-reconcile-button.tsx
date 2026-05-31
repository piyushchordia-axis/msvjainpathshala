'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function RunReconcileButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run() {
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/punya/reconcile', { method: 'POST' });
        const j = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(j?.error?.message ?? `Reconcile failed (${res.status})`);
        }
        const drift = j?.data?.drift_count ?? 0;
        setMessage(`Reconcile completed — drift_count=${drift}.`);
        router.refresh();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Reconcile failed.');
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
      >
        {pending ? 'Running…' : 'Run reconcile now'}
      </button>
      {message ? <div className="text-xs text-muted-foreground">{message}</div> : null}
    </div>
  );
}
