/**
 * Holidays manager (SPEC §5.10) — client island.
 *
 * Pick a centre, then view / add / delete its attendance-calendar holidays.
 * Holidays suppress auto-generated attendance sessions for that date.
 *
 *   GET    /v1/centres/:centreId/holidays
 *   POST   /v1/centres/:centreId/holidays   { date, name }   (sanchalak+)
 *   DELETE /v1/centres/:centreId/holidays/:id                (sanchalak+)
 */

'use client';

import { useCallback, useEffect, useState } from 'react';

import { apiClient, ApiError } from '@/lib/api-client';
import { useToast } from '@/lib/toast-context';

interface CentreOption {
  id: string;
  name: string;
  locality?: string | null;
}

interface HolidayRow {
  id: string;
  date: string;
  name: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
}

export function HolidaysManager({ centres }: { centres: CentreOption[] }) {
  const { push } = useToast();
  const [centreId, setCentreId] = useState<string>(centres[0]?.id ?? '');
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (cid: string) => {
      if (!cid) {
        setHolidays([]);
        return;
      }
      setLoading(true);
      try {
        const data = await apiClient.get<{ items: HolidayRow[] }>(`/v1/centres/${cid}/holidays`);
        setHolidays([...(data.items ?? [])].sort((a, b) => a.date.localeCompare(b.date)));
      } catch (err) {
        push({
          tone: 'error',
          title: 'Could not load holidays',
          description: err instanceof ApiError ? err.message : 'Try again',
        });
        setHolidays([]);
      } finally {
        setLoading(false);
      }
    },
    [push],
  );

  useEffect(() => {
    void load(centreId);
  }, [centreId, load]);

  async function addHoliday(e: React.FormEvent) {
    e.preventDefault();
    if (!centreId) {
      push({ tone: 'error', title: 'Pick a centre first' });
      return;
    }
    if (!DATE_RE.test(date)) {
      push({ tone: 'error', title: 'Check the date', description: 'Use the format YYYY-MM-DD.' });
      return;
    }
    if (name.trim().length < 1) {
      push({ tone: 'error', title: 'Add a name', description: 'e.g. Paryushan, Diwali.' });
      return;
    }
    setBusy(true);
    try {
      await apiClient.post(`/v1/centres/${centreId}/holidays`, { date, name: name.trim() });
      push({ tone: 'success', title: 'Holiday added' });
      setDate('');
      setName('');
      await load(centreId);
    } catch (err) {
      push({
        tone: 'error',
        title: 'Could not add holiday',
        description: err instanceof ApiError ? err.message : 'Try again',
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeHoliday(id: string) {
    setBusy(true);
    try {
      await apiClient.delete(`/v1/centres/${centreId}/holidays/${id}`);
      push({ tone: 'success', title: 'Holiday removed' });
      setHolidays((prev) => prev.filter((h) => h.id !== id));
    } catch (err) {
      push({
        tone: 'error',
        title: 'Could not remove holiday',
        description: err instanceof ApiError ? err.message : 'Try again',
      });
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
        <div>
          <label className="block text-sm font-medium text-secondary" htmlFor="date">
            Date
          </label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 rounded-md border border-border bg-white px-3 py-2 text-ink"
          />
        </div>
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
            maxLength={160}
            className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
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
                  <span className="font-medium text-ink">{fmtDate(h.date)}</span>
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
