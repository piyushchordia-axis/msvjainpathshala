'use client';

/**
 * Create-batch form (sanchalak+). Posts to /api/admin/batches/create which
 * proxies POST /v1/centres/:centreId/batches. Surfaces the result via the
 * global toaster.
 */

import { useState, useTransition } from 'react';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';

const AGE_GROUPS = ['bal', 'kishor', 'tarun', 'yuva'] as const;
type AgeGroup = (typeof AGE_GROUPS)[number];

const DAYS: { n: number; label: string }[] = [
  { n: 1, label: 'Mon' },
  { n: 2, label: 'Tue' },
  { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' },
  { n: 6, label: 'Sat' },
  { n: 7, label: 'Sun' },
];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function CreateBatchForm({ centres }: { centres: { id: string; name: string }[] }) {
  const [centreId, setCentreId] = useState(centres[0]?.id ?? '');
  const [name, setName] = useState('');
  const [ageGroup, setAgeGroup] = useState<AgeGroup>('bal');
  const [capacity, setCapacity] = useState('30');
  const [days, setDays] = useState<number[]>([7]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:30');
  const [language, setLanguage] = useState('');
  const [pending, startTransition] = useTransition();

  const capNum = Number(capacity);
  const valid =
    !!centreId &&
    name.trim().length > 0 &&
    Number.isInteger(capNum) &&
    capNum >= 1 &&
    capNum <= 500 &&
    days.length > 0 &&
    HHMM.test(startTime) &&
    HHMM.test(endTime);

  function toggleDay(n: number) {
    setDays((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n].sort((a, b) => a - b)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      toast.error(
        'Check the form',
        'Pick a centre, a name, capacity (1–500), days and valid times.',
      );
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/batches/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            centre_id: centreId,
            name: name.trim(),
            age_group: ageGroup,
            capacity: capNum,
            schedule: { days, start_time: startTime, end_time: endTime },
            ...(language.trim() ? { language_preference: language.trim() } : {}),
          }),
        });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) throw new Error(j?.error?.message ?? `Could not create batch (${res.status})`);
        toast.success('Batch created', `${name.trim()} is ready.`);
        setName('');
      } catch (err) {
        toast.error('Could not create batch', err instanceof Error ? err.message : 'Unknown error');
      }
    });
  }

  if (centres.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        No centres in your scope yet — create a centre first.
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Centre</Label>
          <select
            value={centreId}
            onChange={(e) => setCentreId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          >
            {centres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bal batch — Sunday morning"
          />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">
            Age group
          </Label>
          <select
            value={ageGroup}
            onChange={(e) => setAgeGroup(e.target.value as AgeGroup)}
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm capitalize"
          >
            {AGE_GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Capacity</Label>
          <Input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Days</Label>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => {
              const on = days.includes(d.n);
              return (
                <button
                  key={d.n}
                  type="button"
                  onClick={() => toggleDay(d.n)}
                  className={`rounded-pill border px-3 py-1 text-sm ${
                    on
                      ? 'border-saffron bg-saffron/10 font-semibold text-saffron'
                      : 'border-input text-muted-foreground'
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">
            Start time
          </Label>
          <Input
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            placeholder="09:00"
          />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">End time</Label>
          <Input value={endTime} onChange={(e) => setEndTime(e.target.value)} placeholder="10:30" />
        </div>
        <div className="md:col-span-2">
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">
            Language preference (optional)
          </Label>
          <Input
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            placeholder="e.g. Hindi"
          />
        </div>
        <div className="md:col-span-2 flex items-center justify-end">
          <button
            type="submit"
            disabled={pending || !valid}
            className="rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
          >
            {pending ? 'Creating…' : 'Create batch'}
          </button>
        </div>
      </form>
    </Card>
  );
}
