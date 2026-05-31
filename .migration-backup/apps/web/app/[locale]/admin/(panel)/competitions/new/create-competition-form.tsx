'use client';

/**
 * Create-competition form (city_admin+). Posts to
 * /api/admin/competitions/create → POST /v1/admin/competitions.
 */

import { useState, useTransition } from 'react';

import { AGE_GROUPS } from '@jp/shared';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';

export function CreateCompetitionForm() {
  const [nameEn, setNameEn] = useState('');
  const [nameHi, setNameHi] = useState('');
  const [category, setCategory] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [winnerPoints, setWinnerPoints] = useState('100');
  const [participantPoints, setParticipantPoints] = useState('20');
  const [maxParticipants, setMaxParticipants] = useState('');
  const [ages, setAges] = useState<string[]>([]);
  const [msvOnly, setMsvOnly] = useState(false);
  const [status, setStatus] = useState<'draft' | 'open'>('draft');
  const [pending, startTransition] = useTransition();

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const valid =
    nameEn.trim().length >= 2 &&
    nameHi.trim().length >= 2 &&
    (eventDate === '' || dateRe.test(eventDate));

  function toggleAge(a: string) {
    setAges((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]));
  }

  function numOrUndef(s: string): number | undefined {
    const n = Number(s);
    return s.trim() && Number.isFinite(n) ? n : undefined;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      toast.error('Check the form', 'Bilingual names are required; event date must be YYYY-MM-DD.');
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/competitions/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name_en: nameEn.trim(),
            name_hi: nameHi.trim(),
            status,
            msv_only: msvOnly,
            ...(category.trim() ? { category: category.trim() } : {}),
            ...(eventDate ? { event_date: eventDate } : {}),
            ...(ages.length ? { eligible_age_groups: ages } : {}),
            ...(numOrUndef(winnerPoints) !== undefined
              ? { winner_points: numOrUndef(winnerPoints) }
              : {}),
            ...(numOrUndef(participantPoints) !== undefined
              ? { participant_points: numOrUndef(participantPoints) }
              : {}),
            ...(numOrUndef(maxParticipants) !== undefined
              ? { max_participants: numOrUndef(maxParticipants) }
              : {}),
          }),
        });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) throw new Error(j?.error?.message ?? `Could not create (${res.status})`);
        toast.success('Competition created', `${nameEn.trim()} is ${status}.`);
        setNameEn('');
        setNameHi('');
        setCategory('');
      } catch (err) {
        toast.error(
          'Could not create competition',
          err instanceof Error ? err.message : 'Unknown error',
        );
      }
    });
  }

  return (
    <Card className="p-6">
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field
          label="Name (English)"
          value={nameEn}
          onChange={setNameEn}
          placeholder="Stuti recital"
        />
        <Field label="Name (Hindi)" value={nameHi} onChange={setNameHi} placeholder="स्तुति पाठ" />
        <Field label="Category" value={category} onChange={setCategory} placeholder="Recital" />
        <Field
          label="Event date (optional)"
          value={eventDate}
          onChange={setEventDate}
          placeholder="2026-07-15"
        />
        <Field
          label="Winner points"
          value={winnerPoints}
          onChange={setWinnerPoints}
          type="number"
        />
        <Field
          label="Participant points"
          value={participantPoints}
          onChange={setParticipantPoints}
          type="number"
        />
        <Field
          label="Max participants (optional)"
          value={maxParticipants}
          onChange={setMaxParticipants}
          type="number"
        />
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Status</Label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'draft' | 'open')}
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm capitalize"
          >
            <option value="draft">Draft</option>
            <option value="open">Open for registration</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">
            Eligible age groups (optional)
          </Label>
          <div className="flex flex-wrap gap-2">
            {AGE_GROUPS.map((a) => {
              const on = ages.includes(a);
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => toggleAge(a)}
                  className={`rounded-pill border px-3 py-1 text-sm capitalize ${
                    on
                      ? 'border-saffron bg-saffron/10 font-semibold text-saffron'
                      : 'border-input text-muted-foreground'
                  }`}
                >
                  {a}
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input
            type="checkbox"
            checked={msvOnly}
            onChange={(e) => setMsvOnly(e.target.checked)}
            className="h-4 w-4"
          />
          MSV students only
        </label>
        <div className="md:col-span-2 flex items-center justify-end">
          <button
            type="submit"
            disabled={pending || !valid}
            className="rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
          >
            {pending ? 'Creating…' : 'Create competition'}
          </button>
        </div>
      </form>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <Label className="mb-1 block text-xs font-semibold text-muted-foreground">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
      />
    </div>
  );
}
