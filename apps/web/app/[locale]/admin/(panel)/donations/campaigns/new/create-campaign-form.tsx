'use client';

/**
 * Create-donation-campaign form (city_admin+). Posts to
 * /api/admin/donations/campaigns → POST /v1/admin/donation-campaigns.
 */

import { useState, useTransition } from 'react';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';

interface CityOpt {
  id: string;
  label: string;
}

function toIso(date: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  return `${date}T00:00:00.000Z`;
}

export function CreateCampaignForm({ cities }: { cities: CityOpt[] }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cityId, setCityId] = useState('');
  const [targetRupees, setTargetRupees] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [progressVisible, setProgressVisible] = useState(true);
  const [pending, startTransition] = useTransition();

  const valid = name.trim().length >= 2;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      toast.error('Check the form', 'A campaign name (2+ characters) is required.');
      return;
    }
    const target = targetRupees.trim() ? Math.round(Number(targetRupees) * 100) : undefined;
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/donations/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            is_public: isPublic,
            progress_bar_visible: progressVisible,
            ...(description.trim() ? { description: description.trim() } : {}),
            ...(cityId ? { city_id: cityId } : {}),
            ...(target !== undefined && Number.isFinite(target)
              ? { target_amount_paise: target }
              : {}),
            ...(toIso(startsAt) ? { starts_at: toIso(startsAt) } : {}),
            ...(toIso(endsAt) ? { ends_at: toIso(endsAt) } : {}),
          }),
        });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) throw new Error(j?.error?.message ?? `Could not create (${res.status})`);
        toast.success('Campaign created', name.trim());
        setName('');
        setDescription('');
        setTargetRupees('');
      } catch (err) {
        toast.error(
          'Could not create campaign',
          err instanceof Error ? err.message : 'Unknown error',
        );
      }
    });
  }

  return (
    <Card className="p-6">
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Paryushan 2026 appeal"
          />
        </div>
        <div className="md:col-span-2">
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">
            Description
          </Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this campaign funds"
          />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">
            City (optional)
          </Label>
          <select
            value={cityId}
            onChange={(e) => setCityId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          >
            <option value="">All cities</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">
            Target amount (₹, optional)
          </Label>
          <Input
            type="number"
            value={targetRupees}
            onChange={(e) => setTargetRupees(e.target.value)}
            placeholder="500000"
          />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">
            Starts (optional)
          </Label>
          <Input
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            placeholder="2026-08-01"
          />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">
            Ends (optional)
          </Label>
          <Input
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            placeholder="2026-08-31"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="h-4 w-4"
          />
          Public (shows on the website)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={progressVisible}
            onChange={(e) => setProgressVisible(e.target.checked)}
            className="h-4 w-4"
          />
          Show progress bar
        </label>
        <div className="md:col-span-2 flex items-center justify-end">
          <button
            type="submit"
            disabled={pending || !valid}
            className="rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
          >
            {pending ? 'Creating…' : 'Create campaign'}
          </button>
        </div>
      </form>
    </Card>
  );
}
