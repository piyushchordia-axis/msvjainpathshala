/**
 * Admin → Notice composer (`/admin/notices/new`).
 *
 * Matches `jp-design-system/preview/admin-forms.html`:
 *   - Bilingual editor fields content_en / content_hi side-by-side
 *   - Scope picker (batch / centre / city / state / national / msv)
 *   - Toggles: Pinned, Public (guest-visible), Critical (SMS fallback)
 *   - Schedule picker (optional)
 *   - "Critical" toggle triggers a ConfirmDialog that fetches the real SMS cost
 *     estimate from `/api/admin/notices/estimate-sms` and renders:
 *       "This will send an SMS to [N] recipients. Estimated cost: ₹[X].
 *        Are you sure?"
 *     before allowing submit.
 */

'use client';

import { useRouter } from 'next/navigation';
import React, { useCallback, useState } from 'react';

import type { NoticeScope } from '@/api/notices';

interface FormState {
  scope: NoticeScope;
  content_en: string;
  content_hi: string;
  pinned: boolean;
  is_public: boolean;
  is_critical: boolean;
  send_sms: boolean;
  scheduled_for: string;
}

const INITIAL_FORM: FormState = {
  scope: 'city',
  content_en: '',
  content_hi: '',
  pinned: false,
  is_public: false,
  is_critical: false,
  send_sms: false,
  scheduled_for: '',
};

export default function NewNoticePage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<null | {
    recipients: number;
    cost_paise: number;
    segments: number;
  }>(null);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        scope: form.scope,
        content_en: form.content_en,
        content_hi: form.content_hi,
        pinned: form.pinned,
        is_public: form.is_public,
        is_critical: form.is_critical,
        send_sms: form.send_sms,
      };
      if (form.scheduled_for) body.scheduled_for = new Date(form.scheduled_for).toISOString();
      const res = await fetch('/api/admin/notices/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        throw new Error(payload.error?.message ?? `Failed (${res.status})`);
      }
      router.push('/admin/notices');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post notice');
      setSubmitting(false);
    }
  }, [form, router]);

  const tapPost = useCallback(async () => {
    setError(null);
    if (!form.content_en.trim() || !form.content_hi.trim()) {
      setError('Both English and Hindi content are required');
      return;
    }
    if (form.is_critical) {
      try {
        const res = await fetch('/api/admin/notices/estimate-sms', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            scope: form.scope,
            content_en: form.content_en,
            content_hi: form.content_hi,
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          data?: { recipients: number; cost_paise: number; worst_segments_per_recipient: number };
          error?: { message?: string };
        };
        if (!res.ok || !payload.data) {
          setError(payload.error?.message ?? 'Could not estimate cost');
          return;
        }
        setConfirmDialog({
          recipients: payload.data.recipients,
          cost_paise: payload.data.cost_paise,
          segments: payload.data.worst_segments_per_recipient,
        });
        return;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not estimate cost');
        return;
      }
    }
    await submit();
  }, [form, submit]);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">New notice</h2>
        <p className="text-sm text-muted-foreground">
          Compose a bilingual announcement and choose the audience. Critical notices fan out as push
          + SMS — you'll see the cost before sending.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Scope
          </label>
          <select
            value={form.scope}
            onChange={(e) => update('scope', e.target.value as NoticeScope)}
            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="batch">Batch</option>
            <option value="centre">Centre</option>
            <option value="city">City</option>
            <option value="state">State</option>
            <option value="national">National</option>
            <option value="msv">MSV cohort</option>
          </select>
        </div>

        {/* Bilingual editor — side-by-side */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Content — English
            </label>
            <textarea
              value={form.content_en}
              onChange={(e) => update('content_en', e.target.value)}
              rows={6}
              maxLength={4000}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-6"
              placeholder="Parents meeting tomorrow at 6pm…"
            />
            <p className="mt-1 text-xs text-muted-foreground">{form.content_en.length} / 4000</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              सामग्री — हिन्दी
            </label>
            <textarea
              value={form.content_hi}
              onChange={(e) => update('content_hi', e.target.value)}
              rows={6}
              maxLength={4000}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-7"
              placeholder="कल शाम 6 बजे अभिभावक बैठक…"
              style={{ fontFamily: '"Mukta", system-ui, sans-serif' }}
            />
            <p className="mt-1 text-xs text-muted-foreground">{form.content_hi.length} / 4000</p>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Schedule for (optional)
          </label>
          <input
            type="datetime-local"
            value={form.scheduled_for}
            onChange={(e) => update('scheduled_for', e.target.value)}
            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm md:w-auto"
          />
          <p className="mt-1 text-xs text-muted-foreground">Leave empty to publish immediately.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Toggle
            label="Pinned"
            value={form.pinned}
            onChange={(v) => update('pinned', v)}
            hint="Floats to the top of the feed."
          />
          <Toggle
            label="Public"
            value={form.is_public}
            onChange={(v) => update('is_public', v)}
            hint="Visible on the public website."
          />
          <Toggle
            label="Send SMS"
            value={form.send_sms}
            onChange={(v) => update('send_sms', v)}
            hint="Pair with critical."
          />
          <Toggle
            label="Critical"
            tone="error"
            value={form.is_critical}
            onChange={(v) => {
              update('is_critical', v);
              if (v) update('send_sms', true);
            }}
            hint="Push + SMS — confirm cost before send."
          />
        </div>
      </section>

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
          onClick={() => void tapPost()}
          disabled={submitting}
          className="rounded-md bg-saffron px-5 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
        >
          {submitting ? 'Sending…' : form.scheduled_for ? 'Schedule' : 'Post notice'}
        </button>
      </div>

      {confirmDialog ? (
        <ConfirmDialog
          recipients={confirmDialog.recipients}
          costPaise={confirmDialog.cost_paise}
          segments={confirmDialog.segments}
          onCancel={() => setConfirmDialog(null)}
          onConfirm={async () => {
            setConfirmDialog(null);
            await submit();
          }}
        />
      ) : null}
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
  tone,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  tone?: 'error';
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`rounded-md border p-3 text-left text-sm ${
        value
          ? tone === 'error'
            ? 'border-destructive bg-destructive/5'
            : 'border-saffron bg-saffron-50'
          : 'border-input bg-background'
      }`}
      role="switch"
      aria-checked={value}
    >
      <div className="flex items-center justify-between">
        <span className={`font-semibold ${tone === 'error' && value ? 'text-destructive' : ''}`}>
          {label}
        </span>
        <span
          className={`ml-2 inline-block h-4 w-7 rounded-full ${
            value ? (tone === 'error' ? 'bg-destructive' : 'bg-saffron') : 'bg-border'
          }`}
        />
      </div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </button>
  );
}

function ConfirmDialog({
  recipients,
  costPaise,
  segments,
  onCancel,
  onConfirm,
}: {
  recipients: number;
  costPaise: number;
  segments: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const inr = (costPaise / 100).toFixed(2);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-card p-6 shadow-xl">
        <h3 className="font-display text-xl text-destructive">Send critical notice?</h3>
        <p className="mt-3 text-sm text-ink">
          This will send an SMS to <strong>{recipients}</strong> recipients.
        </p>
        <p className="mt-1 text-sm text-ink">
          Estimated cost: <strong>₹{inr}</strong>
          <span className="ml-2 text-xs text-muted-foreground">
            ({segments} segment{segments === 1 ? '' : 's'} per recipient)
          </span>
        </p>
        <p className="mt-3 text-sm text-muted-foreground">Are you sure?</p>
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-input px-4 py-2 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-white"
          >
            Yes, send it
          </button>
        </div>
      </div>
    </div>
  );
}
