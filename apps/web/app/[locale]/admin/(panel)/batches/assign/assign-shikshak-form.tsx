'use client';

/**
 * Assign a Guruji / Didi (shikshak) to a batch. Posts to
 * /api/admin/batches/assign-shikshak → POST /v1/batches/:id/shikshak-assignments.
 */

import { useState, useTransition } from 'react';

import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';

interface BatchOpt {
  id: string;
  name: string;
  centre_name: string;
}
interface ShikshakOpt {
  id: string;
  full_name: string;
  phone: string;
}

export function AssignShikshakForm({
  batches,
  shikshaks,
}: {
  batches: BatchOpt[];
  shikshaks: ShikshakOpt[];
}) {
  const [batchId, setBatchId] = useState(batches[0]?.id ?? '');
  const [userId, setUserId] = useState(shikshaks[0]?.id ?? '');
  const [pending, startTransition] = useTransition();

  const valid = !!batchId && !!userId;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      toast.error('Check the form', 'Pick both a batch and a Guruji / Didi.');
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/batches/assign-shikshak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch_id: batchId, user_id: userId }),
        });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) throw new Error(j?.error?.message ?? `Could not assign (${res.status})`);
        toast.success('Assigned', 'The Guruji / Didi now leads this batch.');
      } catch (err) {
        toast.error('Could not assign', err instanceof Error ? err.message : 'Unknown error');
      }
    });
  }

  if (batches.length === 0 || shikshaks.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        {batches.length === 0
          ? 'No batches in your scope yet — create a batch first.'
          : 'No Guruji / Didi in your scope yet.'}
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Batch</Label>
          <select
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          >
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} · {b.centre_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">
            Guruji / Didi
          </Label>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          >
            {shikshaks.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name} · {s.phone}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2 flex items-center justify-end">
          <button
            type="submit"
            disabled={pending || !valid}
            className="rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
          >
            {pending ? 'Assigning…' : 'Assign to batch'}
          </button>
        </div>
      </form>
    </Card>
  );
}
