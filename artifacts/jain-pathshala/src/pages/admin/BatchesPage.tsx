import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast-jp';

interface AdminBatchRow {
  id: string;
  name: string | null;
  centre_name: string;
  age_group: string;
  shikshak_name: string | null;
  day_of_week: number[];
  start_time: string;
  end_time: string;
  status: 'active' | 'inactive';
}

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatDays(days: number[]): string {
  if (!days?.length) return '—';
  return days.map((d) => DAY_NAMES[d] ?? String(d)).join(', ');
}

function formatTime(start: string, end: string): string {
  const trim = (t: string) => (t ? t.slice(0, 5) : '');
  const s = trim(start);
  const e = trim(end);
  if (!s && !e) return '—';
  return `${s}–${e}`;
}

function BatchRowActions({ id, status, onChanged }: { id: string; status: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const action = status === 'active' ? 'deactivate' : 'activate';
    setBusy(true);
    try {
      await apiPost(`/v1/admin/batches/${id}/${action}`, {});
      toast.success(`Batch ${action}d.`);
      onChanged();
    } catch (err) {
      toast.error(`Could not ${action} batch.`, err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant={status === 'active' ? 'secondary' : 'ghost'} disabled={busy} onClick={toggle}>
      {status === 'active' ? 'Deactivate' : 'Activate'}
    </Button>
  );
}

export default function BatchesPage() {
  const [items, setItems] = useState<AdminBatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ data: { items: AdminBatchRow[] } }>('/v1/admin/batches');
      setItems(res.data?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load batches.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">Batches</h2>
          <p className="text-sm text-muted-foreground">Batches across your centres, with their schedule and assigned Guruji.</p>
        </div>
      </header>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Centre</th>
                <th className="px-4 py-3">Age group</th>
                <th className="px-4 py-3">Shikshak</th>
                <th className="px-4 py-3">Day / time</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No batches in scope yet.</td></tr>
              ) : (
                items.map((b) => (
                  <tr key={b.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{b.name || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{b.centre_name}</td>
                    <td className="px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">{b.age_group}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{b.shikshak_name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDays(b.day_of_week)} · {formatTime(b.start_time, b.end_time)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={b.status === 'active'
                        ? 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700'
                        : 'rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground'}
                      >{b.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <BatchRowActions id={b.id} status={b.status} onChanged={load} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
