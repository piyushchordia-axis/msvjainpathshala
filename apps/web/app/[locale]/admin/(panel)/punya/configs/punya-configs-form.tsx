'use client';

/**
 * PunyaConfigsForm — client component, one row per feature.
 *
 * Each row exposes:
 *   - feature.key (read-only label)
 *   - default_points (read-only)
 *   - points_override (editable, validated against min/max)
 *   - "Save" inline button (calls POST /admin/punya/configs)
 *
 * The whole grid is rendered as a `<form>` per row so React 19 form
 * actions can pick up the submission without redrawing siblings.
 */

import { useTransition, useState } from 'react';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

import type { PunyaFeature } from '@/api/punya';

interface Props {
  features: PunyaFeature[];
}

export function PunyaConfigsForm({ features }: Props) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Feature</th>
              <th className="px-4 py-3 text-right">Default</th>
              <th className="px-4 py-3 text-right">Min</th>
              <th className="px-4 py-3 text-right">Max</th>
              <th className="px-4 py-3 text-right">Override (this city)</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {features.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  No Punya features yet — seed the catalogue first.
                </td>
              </tr>
            ) : (
              features.map((f) => <FeatureRow key={f.id} feature={f} />)
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function FeatureRow({ feature }: { feature: PunyaFeature }) {
  const [override, setOverride] = useState<string>(String(feature.default_points));
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const min = feature.min_points ?? -1000;
  const max = feature.max_points ?? 1000;
  const value = Number(override);
  const outOfBounds = Number.isFinite(value) && (value < min || value > max);

  function save() {
    setError(null);
    setMessage(null);
    if (!Number.isFinite(value)) {
      setError('Enter a whole number.');
      return;
    }
    if (outOfBounds) {
      setError(`Must be between ${min} and ${max}.`);
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/punya/configs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feature_id: feature.id, points_override: value }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.error?.message ?? `Save failed (${res.status})`);
        }
        setMessage('Saved.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed.');
      }
    });
  }

  return (
    <tr className="hover:bg-muted/30">
      <td className="px-4 py-3">
        <div className="font-medium text-foreground">{prettifyKey(feature.key)}</div>
        <div className="text-xs text-muted-foreground">
          {feature.is_manual ? 'Manual award' : 'Automatic award'}
          {feature.requires_reason ? ' · requires reason' : ''}
        </div>
      </td>
      <td className="px-4 py-3 text-right">{feature.default_points}</td>
      <td className="px-4 py-3 text-right text-muted-foreground">{feature.min_points ?? '—'}</td>
      <td className="px-4 py-3 text-right text-muted-foreground">{feature.max_points ?? '—'}</td>
      <td className="px-4 py-3">
        <Input
          type="number"
          value={override}
          onChange={(e) => setOverride(e.target.value)}
          className="w-24 text-right"
          invalid={outOfBounds}
        />
        {error ? (
          <div className="mt-1 text-xs text-destructive">{error}</div>
        ) : message ? (
          <div className="mt-1 text-xs text-success">{message}</div>
        ) : null}
      </td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-saffron px-3 py-1.5 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </td>
    </tr>
  );
}

function prettifyKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace('Msv', 'MSV');
}
