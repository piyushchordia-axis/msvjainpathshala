'use client';

/**
 * Holidays manager (SPEC §5.10) — client island.
 *
 * Pick a centre, then view / add / remove its attendance-calendar holidays.
 * Holidays suppress auto-generated attendance sessions for those dates. A
 * holiday is a date range (single-day = same start & end). Mutations go
 * through the Next.js route handlers under /api/admin/centres/:id/holidays
 * which proxy to the API with the caller's bearer token.
 */

import { useCallback, useEffect, useState } from 'react';

import { toast } from '@/components/ui/toast';

interface CentreOption {
  id: string;
  name: string;
  locality?: string | null;
}

interface HolidayRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function rangeLabel(h: HolidayRow): string {
  return h.start_date === h.end_date
    ? fmtDate(h.start_date)
    : `${fmtDate(h.start_date)} – ${fmtDate(h.end_date)}`;
}

async function errorMessage(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return j?.error?.message ?? `Request failed (${res.status})`;
}

export function HolidaysManager({ centres }: { centres: CentreOption[] }) {
  const [centreId, setCentreId] = useState<string>(centres[0]?.id ?? '');
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (cid: string) => {
    if (!cid) {
      setHolidays([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/centres/${cid}/holidays`);
      if (!res.ok) throw new Error(await errorMessage(res));
      const j = (await res.json()) as { data?: { items?: HolidayRow[] }; items?: HolidayRow[] };
      const items = j.data?.items ?? j.items ?? [];
      setHolidays([...items].sort((a, b) => a.start_date.localeCompare(b.start_date)));
    } catch (err) {
      toast.error('Could not load holidays', err instanceof Error ? err.message : 'Try again');
      setHolidays([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(centreId);
  }, [centreId, load]);

  async function addHoliday(e: React.FormEvent) {
    e.preventDefault();
    if (!centreId) {
      toast.error('Pick a centre first');
      return;
    }
    if (name.trim().length < 1) {
      toast.error('Add a name', 'e.g. Paryushan, Diwali.');
      return;
    }
    if (!DATE_RE.test(startDate)) {
      toast.error('Check the start date', 'Use the format YYYY-MM-DD.');
      return;
    }
    const end = endDate || startDate;
    if (!DATE_RE.test(end)) {
      toast.error('Check the end date', 'Use the format YYYY-MM-DD.');
      return;
    }
    if (end < startDate) {
      toast.error('Invalid range', 'The end date is before the start date.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/centres/${centreId}/holidays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), start_date: startDate, end_date: end }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      toast.success('Holiday added', name.trim());
      setName('');
      setStartDate('');
      setEndDate('');
      await load(centreId);
    } catch (err) {
      toast.error('Could not add holiday', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(false);
    }
  }

  async function removeHoliday(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/centres/${centreId}/holidays/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) throw new Error(await errorMessage(res));
      toast.success('Holiday removed');
      setHolidays((prev) => prev.filter((h) => h.id !== id));
    } catch (err) {
      toast.error('Could not remove holiday', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(false);
    }
  }

  if (centres.length === 0) {
    return <p className="mt-6 text-muted-foreground">No centres are available in your scope.</p>;
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="max-w-sm">
        <label className="block text-sm font-medium text-secondary" htmlFor="centre">
          Centre
        </label>
        <select
          id="centre"
          value={centreId}
          onChange={(e) => setCentreId(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-cream-dark px-3 py-2 text-ink"
        >
          {centres.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.locality ? ` — ${c.locality}` : ''}
            </option>
          ))}
        </select>
      </div>

      <form
        onSubmit={addHoliday}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-cream-dark p-4"
      >
        <div className="flex-1 min-w-[12rem]">
          <label className="block text-sm font-medium text-secondary" htmlFor="name">
            Holiday name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Paryushan"
            maxLength={200}
            className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-secondary" htmlFor="start">
            Start
          </label>
          <input
            id="start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 rounded-md border border-border bg-white px-3 py-2 text-ink"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-secondary" htmlFor="end">
            End (optional)
          </label>
          <input
            id="end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1 rounded-md border border-border bg-white px-3 py-2 text-ink"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-saffron px-4 py-2 font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
        >
          Add holiday
        </button>
      </form>

      <div>
        <h2 className="font-display text-xl text-secondary">Scheduled holidays</h2>
        {loading ? (
          <p className="mt-3 text-muted-foreground">Loading…</p>
        ) : holidays.length === 0 ? (
          <p className="mt-3 text-muted-foreground">No holidays set for this centre yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-3">
                <div>
                  <span className="font-medium text-ink">{rangeLabel(h)}</span>
                  <span className="ml-3 text-sm text-muted-foreground">{h.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void removeHoliday(h.id)}
                  disabled={busy}
                  className="text-sm font-semibold text-destructive hover:underline disabled:opacity-60"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
