'use client';

/**
 * Start-impersonation form (super_admin only). Posts to
 * /api/admin/impersonate/[userId]; on success the page reloads as the target
 * user and the red impersonation banner appears. Surfaced via the toaster.
 */

import { useState, useTransition } from 'react';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ImpersonateForm() {
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();

  const valid = UUID.test(userId.trim()) && reason.trim().length >= 3;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      toast.error(
        'Check the form',
        'Enter a valid user UUID and a reason (at least 3 characters).',
      );
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/impersonate/${userId.trim()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() }),
        });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) {
          throw new Error(j?.error?.message ?? `Could not impersonate (${res.status})`);
        }
        toast.success('Impersonation started', 'Reloading as the selected user…');
        setTimeout(() => window.location.reload(), 700);
      } catch (err) {
        toast.error('Could not impersonate', err instanceof Error ? err.message : 'Unknown error');
      }
    });
  }

  return (
    <Card className="space-y-4 p-6">
      <div>
        <h3 className="font-display text-lg text-secondary">Impersonate a user</h3>
        <p className="text-sm text-muted-foreground">
          Acts as the selected user for support and debugging. Every action is double-audited and a
          banner stays visible until you stop.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label
            htmlFor="imp_user"
            className="mb-1 block text-xs font-semibold text-muted-foreground"
          >
            User ID
          </Label>
          <Input
            id="imp_user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="font-mono"
          />
        </div>
        <div>
          <Label
            htmlFor="imp_reason"
            className="mb-1 block text-xs font-semibold text-muted-foreground"
          >
            Reason
          </Label>
          <Input
            id="imp_reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Investigating a reported attendance issue"
          />
        </div>
        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={pending || !valid}
            className="rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
          >
            {pending ? 'Starting…' : 'Start impersonation'}
          </button>
        </div>
      </form>
    </Card>
  );
}
