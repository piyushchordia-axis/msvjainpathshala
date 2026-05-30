'use client';

/**
 * Inline status changer for a service request. Posts to
 * /api/admin/service-requests/:id/status and toasts the result.
 */

import { useState, useTransition } from 'react';

import { SERVICE_REQUEST_STATUSES } from '@jp/shared';

import { toast } from '@/components/ui/toast';

export function ServiceRequestStatus({ id, status }: { id: string; status: string }) {
  const [value, setValue] = useState(status);
  const [pending, startTransition] = useTransition();

  function save(next: string) {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/service-requests/${id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: next }),
        });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) throw new Error(j?.error?.message ?? `Could not update (${res.status})`);
        toast.success('Status updated', next.replace(/_/g, ' '));
      } catch (err) {
        setValue(previous);
        toast.error('Could not update', err instanceof Error ? err.message : 'Unknown error');
      }
    });
  }

  return (
    <select
      value={value}
      onChange={(e) => save(e.target.value)}
      disabled={pending}
      className="rounded-md border border-input bg-card px-2 py-1 text-xs capitalize disabled:opacity-60"
    >
      {SERVICE_REQUEST_STATUSES.map((s) => (
        <option key={s} value={s}>
          {s.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  );
}
