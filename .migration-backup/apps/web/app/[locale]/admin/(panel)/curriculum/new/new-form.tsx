/**
 * Client form for /admin/curriculum/new.
 *
 * MSV type option only rendered when allowMsv=true. The server-side
 * NestJS Q2 guard remains the authoritative check — for a fast-fail UX, the
 * UI hides the option so the error path is rarely exercised.
 */

'use client';

import { useRouter } from 'next/navigation';
import React, { useCallback, useState } from 'react';

import type { CurriculumKind } from '@/api/curriculum';

interface FormState {
  kind: CurriculumKind;
  name: string;
  academic_year: string;
  status: 'draft' | 'active' | 'archived';
}

export default function NewCurriculumForm({ allowMsv }: { allowMsv: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    kind: 'standard',
    name: '',
    academic_year: '',
    status: 'draft',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const submit = useCallback(async () => {
    setError(null);
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        kind: form.kind,
        name: form.name.trim(),
        status: form.status,
      };
      if (form.academic_year.trim()) body.academic_year = form.academic_year.trim();
      const res = await fetch('/api/admin/curriculum/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        // Surface Q2 verbatim when it fires.
        if (payload.error?.code === 'ERR_RBAC_FORBIDDEN_MSV_CURRICULUM') {
          setError('Only super_admin can create MSV curricula');
        } else {
          setError(payload.error?.message ?? `Failed (${res.status})`);
        }
        setSubmitting(false);
        return;
      }
      router.push('/admin/curriculum');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create curriculum');
      setSubmitting(false);
    }
  }, [form, router]);

  return (
    <section className="space-y-5 rounded-lg border border-border bg-card p-6">
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Type
          </label>
          <select
            value={form.kind}
            onChange={(e) => update('kind', e.target.value as CurriculumKind)}
            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="standard">Standard (city)</option>
            {allowMsv ? <option value="msv">MSV (national)</option> : null}
          </select>
          {!allowMsv ? (
            <p className="mt-1 text-xs italic text-muted-foreground">
              MSV curricula are managed by super_admin only.
            </p>
          ) : null}
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Status
          </label>
          <select
            value={form.status}
            onChange={(e) => update('status', e.target.value as FormState['status'])}
            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Name
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          maxLength={140}
          placeholder="e.g. Bal Pathshala 2025-26"
          className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Academic year (optional)
        </label>
        <input
          type="text"
          value={form.academic_year}
          onChange={(e) => update('academic_year', e.target.value)}
          maxLength={40}
          placeholder="e.g. 2025-26"
          className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm md:max-w-xs"
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-input px-4 py-2 text-sm font-semibold"
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="rounded-md bg-saffron px-5 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Create curriculum'}
        </button>
      </div>
    </section>
  );
}
