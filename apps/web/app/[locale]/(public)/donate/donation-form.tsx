/**
 * Donation form (client component).
 *
 * Submits to `/v1/donations/initiate` via the public API base URL. In a
 * production deployment the form then hands `razorpay_order_id` to the
 * Razorpay checkout SDK; in dev / preview we surface the returned order
 * id directly so a manual `/v1/donations/verify` call can complete the
 * flow without standing up Razorpay credentials.
 *
 * Field style mirrors jp-design-system/preview/admin-forms.html:
 *   - 1.5px cream-deeper border on resting inputs
 *   - 2px saffron + 28% saffron ring on focus
 *   - rounded 10px (rounded-md = 6px is too tight; we use rounded-lg)
 *   - error state: bg-status-error-soft + 1.5px destructive border
 */

'use client';

import { useMemo, useState, type ReactElement, type ReactNode } from 'react';

const PUBLIC_API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.NEXT_PUBLIC_INTERNAL_API_BASE_URL ??
  'http://localhost:3000';

const AMOUNT_CHIPS = [
  { label: '₹501', paise: 50_100 },
  { label: '₹1,001', paise: 1_00_100 },
  { label: '₹2,501', paise: 2_50_100 },
  { label: '₹5,001', paise: 5_00_100 },
] as const;

interface CampaignSummary {
  id: string;
  name: string;
}

interface DonationFormProps {
  campaigns: CampaignSummary[];
}

interface InitiateResponse {
  data?: {
    donation: { id: string; amount_paise: number; status: string };
    razorpay_order_id: string;
    razorpay_key_id: string;
    amount_paise: number;
    currency: string;
  };
  error?: { code: string; message: string };
}

export function DonationForm({ campaigns }: DonationFormProps) {
  const [selected, setSelected] = useState<number | 'custom'>(1_00_100);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [purpose, setPurpose] = useState<'general' | 'shivir' | 'scholarship' | 'infrastructure'>(
    'general',
  );
  const [campaignId, setCampaignId] = useState<string>('');
  const [donor, setDonor] = useState({ name: '', email: '', phone: '', pan: '' });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; order_id?: string } | null>(
    null,
  );

  const amountPaise = useMemo<number>(() => {
    if (selected === 'custom') {
      const inr = Number.parseInt(customAmount.replace(/[^0-9]/g, ''), 10);
      if (!Number.isFinite(inr) || inr <= 0) return 0;
      return inr * 100;
    }
    return selected;
  }, [selected, customAmount]);

  const amountInr = (amountPaise / 100).toLocaleString('en-IN');

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setResult(null);
    if (amountPaise < 100) {
      setResult({ ok: false, message: 'Pick an amount of at least ₹1.' });
      return;
    }
    if (!donor.name.trim()) {
      setResult({ ok: false, message: 'Please tell us your name so we can issue the receipt.' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${PUBLIC_API_BASE_URL}/v1/donations/initiate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amount_paise: amountPaise,
          currency: 'INR',
          purpose,
          campaign_id: campaignId || null,
          frequency: 'one_time',
          donor: {
            name: donor.name.trim(),
            email: donor.email.trim() || null,
            phone: donor.phone.trim() || null,
            pan: donor.pan.trim().toUpperCase() || null,
          },
        }),
      });
      const json = (await res.json()) as InitiateResponse;
      if (!res.ok || !json.data) {
        setResult({
          ok: false,
          message:
            json.error?.message ?? "We couldn't start your donation. Please try again in a moment.",
        });
        return;
      }
      setResult({
        ok: true,
        order_id: json.data.razorpay_order_id,
        message:
          'Order created. In production the Razorpay checkout opens next; in preview, use the order id above to verify.',
      });
    } catch (err) {
      setResult({
        ok: false,
        message: `Network error — ${err instanceof Error ? err.message : 'please try again'}.`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="grid gap-6" onSubmit={submit}>
      {/* Amount chips */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-ink-sub">
          Amount
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {AMOUNT_CHIPS.map((chip) => {
            const active = selected === chip.paise;
            return (
              <button
                key={chip.paise}
                type="button"
                onClick={() => setSelected(chip.paise)}
                className={
                  'rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ' +
                  (active
                    ? 'border-saffron bg-saffron-50 text-saffron-700 ring-2 ring-saffron/30'
                    : 'border-cream-deeper bg-white text-ink hover:border-saffron')
                }
              >
                {chip.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setSelected('custom')}
            className={
              'rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ' +
              (selected === 'custom'
                ? 'border-saffron bg-saffron-50 text-saffron-700 ring-2 ring-saffron/30'
                : 'border-cream-deeper bg-white text-ink hover:border-saffron')
            }
          >
            Custom
          </button>
        </div>
        {selected === 'custom' ? (
          <div className="mt-3">
            <div className="flex items-center gap-2 rounded-lg border-2 border-saffron bg-white px-3 py-2 text-base font-semibold text-ink shadow-[0_0_0_3px_rgba(212,98,26,0.28)]">
              <span className="text-ink-sub">₹</span>
              <input
                inputMode="numeric"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder="Enter amount"
                className="w-full bg-transparent text-base outline-none placeholder:text-ink-dim"
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Your name" required>
          <input
            type="text"
            value={donor.name}
            onChange={(e) => setDonor((d) => ({ ...d, name: e.target.value }))}
            required
            className={fieldClass()}
            placeholder="e.g. Rajesh Mehta"
          />
        </Field>
        <Field label="Phone" hint="Optional · used for the SMS receipt copy">
          <input
            type="tel"
            value={donor.phone}
            onChange={(e) => setDonor((d) => ({ ...d, phone: e.target.value }))}
            className={fieldClass()}
            placeholder="+91…"
          />
        </Field>
        <Field label="Email" hint="Optional · receipt will be emailed here">
          <input
            type="email"
            value={donor.email}
            onChange={(e) => setDonor((d) => ({ ...d, email: e.target.value }))}
            className={fieldClass()}
            placeholder="you@example.com"
          />
        </Field>
        <Field label="PAN" hint="Required only if you want an 80G certificate">
          <input
            type="text"
            value={donor.pan}
            onChange={(e) => setDonor((d) => ({ ...d, pan: e.target.value.toUpperCase() }))}
            className={fieldClass() + ' font-mono uppercase tracking-wider'}
            placeholder="ABCDE1234F"
            maxLength={10}
          />
        </Field>
        <Field label="Purpose">
          <select
            value={purpose}
            onChange={(e) =>
              setPurpose(e.target.value as 'general' | 'shivir' | 'scholarship' | 'infrastructure')
            }
            className={fieldClass()}
          >
            <option value="general">General fund</option>
            <option value="shivir">Shivir</option>
            <option value="scholarship">Scholarship</option>
            <option value="infrastructure">Infrastructure</option>
          </select>
        </Field>
        {campaigns.length ? (
          <Field label="Campaign" hint="Optional · directs your gift">
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className={fieldClass()}
            >
              <option value="">— None —</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={submitting || amountPaise === 0}
        className="mt-2 inline-flex w-full items-center justify-center rounded-lg bg-saffron px-6 py-3 text-base font-semibold text-cream shadow-[0_2px_4px_rgba(212,98,26,0.35)] transition-colors hover:bg-saffron-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Starting…' : `Donate ₹${amountInr}`}
      </button>

      {result ? (
        <div
          role="status"
          className={
            'rounded-lg border p-3 text-sm ' +
            (result.ok
              ? 'border-status-success bg-status-success-soft text-status-success'
              : 'border-destructive bg-status-error-soft text-destructive')
          }
        >
          <div>{result.message}</div>
          {result.order_id ? (
            <div className="mt-1 font-mono text-xs">order id · {result.order_id}</div>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-ink-sub">
        Donations are processed by Razorpay. By donating you agree to our terms.
      </p>
    </form>
  );
}

function fieldClass(invalid = false): string {
  const base =
    'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-ink shadow-sm transition-shadow placeholder:text-ink-dim focus:outline-none focus:ring-2 ';
  return invalid
    ? `${base} border-destructive focus:border-destructive focus:ring-destructive/30`
    : `${base} border-cream-deeper focus:border-saffron focus:ring-saffron/30`;
}

interface FieldProps {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}

function Field({ label, hint, required, children }: FieldProps): ReactElement {
  return (
    <label className="block">
      <span className="mb-1.5 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.06em] text-ink-sub">
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-ink-sub">{hint}</span> : null}
    </label>
  );
}
