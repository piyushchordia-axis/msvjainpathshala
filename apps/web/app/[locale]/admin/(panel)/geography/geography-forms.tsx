'use client';

/**
 * Geography admin forms: create a state (super_admin) and a city (state_admin+).
 * Post to the /api/admin/geography/* route handlers; toasts on result.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';

export function CreateStateForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [pending, startTransition] = useTransition();
  const valid = name.trim().length >= 1 && code.trim().length >= 2 && code.trim().length <= 8;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      toast.error('Check the form', 'Name and a 2–8 character code are required.');
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/geography/states', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), code: code.trim().toUpperCase() }),
        });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) throw new Error(j?.error?.message ?? `Could not create (${res.status})`);
        toast.success('State created', name.trim());
        setName('');
        setCode('');
        router.refresh();
      } catch (err) {
        toast.error('Could not create state', err instanceof Error ? err.message : 'Unknown error');
      }
    });
  }

  return (
    <Card className="space-y-4 p-6">
      <h3 className="font-display text-lg text-secondary">New state</h3>
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gujarat" />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Code</Label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="GJ" />
        </div>
        <div className="md:col-span-2 flex justify-end">
          <button
            type="submit"
            disabled={pending || !valid}
            className="rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
          >
            {pending ? 'Creating…' : 'Create state'}
          </button>
        </div>
      </form>
    </Card>
  );
}

export function CreateCityForm({ states }: { states: { id: string; name: string }[] }) {
  const router = useRouter();
  const [stateId, setStateId] = useState(states[0]?.id ?? '');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [pending, startTransition] = useTransition();
  const valid =
    !!stateId && name.trim().length >= 1 && code.trim().length >= 2 && code.trim().length <= 8;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      toast.error('Check the form', 'Pick a state, a name and a 2–8 character code.');
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/geography/cities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state_id: stateId,
            name: name.trim(),
            code: code.trim().toUpperCase(),
          }),
        });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) throw new Error(j?.error?.message ?? `Could not create (${res.status})`);
        toast.success('City created', name.trim());
        setName('');
        setCode('');
        router.refresh();
      } catch (err) {
        toast.error('Could not create city', err instanceof Error ? err.message : 'Unknown error');
      }
    });
  }

  if (states.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        No states yet — create a state first.
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-6">
      <h3 className="font-display text-lg text-secondary">New city</h3>
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">State</Label>
          <select
            value={stateId}
            onChange={(e) => setStateId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          >
            {states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ahmedabad" />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Code</Label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="AMD" />
        </div>
        <div className="md:col-span-3 flex justify-end">
          <button
            type="submit"
            disabled={pending || !valid}
            className="rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
          >
            {pending ? 'Creating…' : 'Create city'}
          </button>
        </div>
      </form>
    </Card>
  );
}
