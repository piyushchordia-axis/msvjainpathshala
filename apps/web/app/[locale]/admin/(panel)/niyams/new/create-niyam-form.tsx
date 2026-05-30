'use client';

/**
 * Create-niyam form (shikshak+). Posts to /api/admin/niyams/create →
 * POST /v1/admin/niyams. Type / proof-type options come straight from the
 * shared enums so they always match the backend.
 */

import { useState, useTransition } from 'react';

import { NIYAM_TYPES, PROOF_TYPES } from '@jp/shared';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';

export function CreateNiyamForm() {
  const [titleEn, setTitleEn] = useState('');
  const [titleHi, setTitleHi] = useState('');
  const [descEn, setDescEn] = useState('');
  const [descHi, setDescHi] = useState('');
  const [type, setType] = useState<string>(NIYAM_TYPES[0] ?? '');
  const [proofType, setProofType] = useState<string>(PROOF_TYPES[0] ?? '');
  const [points, setPoints] = useState('10');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [audience, setAudience] = useState<'all' | 'msv_only'>('all');
  const [pending, startTransition] = useTransition();

  const pointsNum = Number(points);
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const valid =
    titleEn.trim().length >= 2 &&
    titleHi.trim().length >= 2 &&
    !!type &&
    !!proofType &&
    Number.isInteger(pointsNum) &&
    pointsNum >= 1 &&
    pointsNum <= 200 &&
    dateRe.test(startDate) &&
    (endDate === '' || dateRe.test(endDate));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      toast.error(
        'Check the form',
        'Bilingual titles, a start date and points (1–200) are required.',
      );
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/niyams/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title_en: titleEn.trim(),
            title_hi: titleHi.trim(),
            type,
            proof_type: proofType,
            points_value: pointsNum,
            start_date: startDate,
            audience_kind: audience,
            ...(endDate ? { end_date: endDate } : {}),
            ...(descEn.trim() ? { description_en: descEn.trim() } : {}),
            ...(descHi.trim() ? { description_hi: descHi.trim() } : {}),
          }),
        });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) throw new Error(j?.error?.message ?? `Could not create niyam (${res.status})`);
        toast.success('Niyam created', `${titleEn.trim()} is live for your scope.`);
        setTitleEn('');
        setTitleHi('');
        setDescEn('');
        setDescHi('');
      } catch (err) {
        toast.error('Could not create niyam', err instanceof Error ? err.message : 'Unknown error');
      }
    });
  }

  return (
    <Card className="p-6">
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field
          label="Title (English)"
          value={titleEn}
          onChange={setTitleEn}
          placeholder="Daily prayer"
        />
        <Field
          label="Title (Hindi)"
          value={titleHi}
          onChange={setTitleHi}
          placeholder="दैनिक प्रार्थना"
        />
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Type</Label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm capitalize"
          >
            {NIYAM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">
            Proof type
          </Label>
          <select
            value={proofType}
            onChange={(e) => setProofType(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm capitalize"
          >
            {PROOF_TYPES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <Field label="Points (1–200)" value={points} onChange={setPoints} type="number" />
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Audience</Label>
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value as 'all' | 'msv_only')}
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          >
            <option value="all">Everyone in scope</option>
            <option value="msv_only">MSV students only</option>
          </select>
        </div>
        <Field
          label="Start date (YYYY-MM-DD)"
          value={startDate}
          onChange={setStartDate}
          placeholder="2026-06-01"
        />
        <Field
          label="End date (optional)"
          value={endDate}
          onChange={setEndDate}
          placeholder="2026-06-30"
        />
        <div className="md:col-span-2 flex items-center justify-end">
          <button
            type="submit"
            disabled={pending || !valid}
            className="rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
          >
            {pending ? 'Creating…' : 'Create niyam'}
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
