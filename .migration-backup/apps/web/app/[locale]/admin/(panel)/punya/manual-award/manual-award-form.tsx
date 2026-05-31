'use client';

/**
 * Manual-award form (client component). Layout mirrors
 * `jp-design-system/preview/admin-forms.html`:
 *   - Two-column grid
 *   - 1.5px border + 10px radius on every input (matches the preview)
 *   - Saffron focus ring + 3px focus shadow
 *   - "Reason" spans both columns
 *
 * On submit it POSTs to `/api/admin/punya/manual-award` and renders the
 * server's success / error inline. Re-submitting the same form within a
 * day is a no-op (idempotency key collapses repeats).
 */

import { useState, useTransition } from 'react';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { PunyaFeature } from '@/api/punya';

interface Props {
  features: PunyaFeature[];
}

interface SubmitResult {
  ok: boolean;
  message: string;
  duplicate?: boolean;
}

export function ManualAwardForm({ features }: Props) {
  const [studentId, setStudentId] = useState('');
  const [featureKey, setFeatureKey] = useState(features[0]?.key ?? '');
  const [points, setPoints] = useState<string>(String(features[0]?.default_points ?? 10));
  const [reason, setReason] = useState('');
  const [isMsv, setIsMsv] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SubmitResult | null>(null);

  const selectedFeature = features.find((f) => f.key === featureKey) ?? null;
  const min = selectedFeature?.min_points ?? -1000;
  const max = selectedFeature?.max_points ?? 1000;
  const pointsNum = Number(points);
  const pointsInvalid = !Number.isFinite(pointsNum) || pointsNum < min || pointsNum > max;
  const reasonInvalid = reason.trim().length < 3;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    if (!studentId.match(/^[0-9a-f-]{36}$/i)) {
      setResult({ ok: false, message: 'Enter a valid student UUID.' });
      return;
    }
    if (pointsInvalid) {
      setResult({ ok: false, message: `Points must be in [${min}..${max}].` });
      return;
    }
    if (reasonInvalid) {
      setResult({ ok: false, message: 'Reason must be at least 3 characters.' });
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/punya/manual-award', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            student_id: studentId,
            feature_key: featureKey,
            points: pointsNum,
            reason,
            is_msv_track: isMsv,
          }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(j?.error?.message ?? `Award failed (${res.status})`);
        }
        setResult({
          ok: true,
          message: j?.data?.duplicate
            ? 'Award is a no-op — same student, feature, and reason were already credited today.'
            : `Awarded ${pointsNum} Punya. New balance: ${j?.data?.balance?.total_points ?? '?'}.`,
          duplicate: !!j?.data?.duplicate,
        });
      } catch (err) {
        setResult({
          ok: false,
          message: err instanceof Error ? err.message : 'Award failed.',
        });
      }
    });
  }

  return (
    <Card className="p-6">
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label
            htmlFor="student_id"
            className="mb-1 block text-xs font-semibold text-muted-foreground"
          >
            Student ID
          </Label>
          <Input
            id="student_id"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="font-mono"
          />
        </div>
        <div>
          <Label
            htmlFor="feature_key"
            className="mb-1 block text-xs font-semibold text-muted-foreground"
          >
            Feature
          </Label>
          <select
            id="feature_key"
            value={featureKey}
            onChange={(e) => {
              const next = e.target.value;
              setFeatureKey(next);
              const f = features.find((x) => x.key === next);
              if (f) setPoints(String(f.default_points));
            }}
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          >
            {features.map((f) => (
              <option key={f.id} value={f.key}>
                {f.key} (default {f.default_points})
              </option>
            ))}
          </select>
          {selectedFeature ? (
            <div className="mt-1 text-xs text-muted-foreground">
              Bounds: {selectedFeature.min_points ?? '—'} … {selectedFeature.max_points ?? '—'}
              {selectedFeature.requires_reason ? ' · reason required' : ''}
            </div>
          ) : null}
        </div>
        <div>
          <Label
            htmlFor="points"
            className="mb-1 block text-xs font-semibold text-muted-foreground"
          >
            Points
          </Label>
          <Input
            id="points"
            type="number"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            invalid={pointsInvalid}
          />
        </div>
        <div className="flex items-end gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isMsv}
              onChange={(e) => setIsMsv(e.target.checked)}
              className="h-4 w-4"
            />
            MSV-track
          </label>
        </div>
        <div className="md:col-span-2">
          <Label
            htmlFor="reason"
            className="mb-1 block text-xs font-semibold text-muted-foreground"
          >
            Reason
          </Label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Helped clean the centre after Paryushan"
            rows={3}
            aria-invalid={reasonInvalid || undefined}
            className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          />
        </div>
        <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3">
          {result ? (
            <div className={result.ok ? 'text-sm text-success' : 'text-sm text-destructive'}>
              {result.message}
            </div>
          ) : (
            <div />
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
          >
            {pending ? 'Awarding…' : 'Award Punya'}
          </button>
        </div>
      </form>
    </Card>
  );
}
