import { useEffect, useState } from 'react';
import { Link, useSearch } from 'wouter';
import { Card } from '@/components/ui/card';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast-jp';
import { Button } from '@/components/ui/button';

type EnrolmentStatus = 'pending' | 'waitlisted' | 'approved' | 'rejected';

interface EnrolmentRow {
  id: string;
  created_at: string;
  decided_at: string | null;
  requested_centre_id: string;
  requested_batch_id: string;
  status: EnrolmentStatus;
  student_name?: string | null;
  student_code?: string;
  centre_name?: string;
  batch_name?: string | null;
}

const STATUS_FILTERS: Array<{ value: EnrolmentStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'waitlisted', label: 'Waitlisted' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const STATUS_STYLES: Record<EnrolmentStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  waitlisted: 'bg-blue-100 text-blue-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtShort(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

interface DecideActionsProps { id: string; status: EnrolmentStatus; onChanged: () => void; }

function DecideActions({ id, status, onChanged }: DecideActionsProps) {
  const [busy, setBusy] = useState<string | null>(null);

  async function act(action: 'approve' | 'waitlist' | 'reject') {
    if (busy) return;
    let body: Record<string, string> = {};
    if (action === 'reject') {
      const reason = window.prompt('Rejection reason (required):');
      if (!reason) return;
      body = { reason };
    }
    setBusy(action);
    try {
      await apiPost(`/v1/admin/enrolments/${id}/${action}`, body);
      toast.success(`Enrolment ${action}ed.`);
      onChanged();
    } catch (err) {
      toast.error(`Could not ${action}.`, err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  if (status !== 'pending' && status !== 'waitlisted') return null;

  return (
    <div className="flex gap-1">
      {status === 'pending' ? (
        <Button size="sm" onClick={() => act('approve')} disabled={!!busy}>
          {busy === 'approve' ? '…' : 'Approve'}
        </Button>
      ) : null}
      {status === 'pending' ? (
        <Button size="sm" variant="outline" onClick={() => act('waitlist')} disabled={!!busy}>
          {busy === 'waitlist' ? '…' : 'Waitlist'}
        </Button>
      ) : null}
      <Button size="sm" variant="secondary" onClick={() => act('reject')} disabled={!!busy}>
        {busy === 'reject' ? '…' : 'Reject'}
      </Button>
    </div>
  );
}

export default function EnrolmentsPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const statusFilter = (params.get('status') as EnrolmentStatus | null) ?? 'all';

  const [items, setItems] = useState<EnrolmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const qs = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const res = await apiGet<{ items: EnrolmentRow[] }>(`/v1/admin/enrolments${qs}`);
      setItems(res?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load enrolments.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [statusFilter]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">Enrolments</h2>
          <p className="text-sm text-muted-foreground">Approve, waitlist, or reject pending applications.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.value;
            const href = f.value === 'all' ? '/admin/enrolments' : `/admin/enrolments?status=${f.value}`;
            return (
              <Link
                key={f.value}
                href={href}
                className={[
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:bg-muted',
                ].join(' ')}
              >
                {f.label}
              </Link>
            );
          })}
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
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Centre</th>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Decided</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No enrolments match the current filter.</td></tr>
              ) : (
                items.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 text-foreground">{fmtDate(e.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{e.student_name ?? '—'}</div>
                      {e.student_code ? (
                        <div className="font-mono text-xs text-muted-foreground">{e.student_code}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs">{e.centre_name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">{e.batch_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[e.status]}`}>{e.status}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{fmtShort(e.decided_at)}</td>
                    <td className="px-4 py-3">
                      <DecideActions id={e.id} status={e.status} onChanged={load} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {items.length > 0 ? (
          <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            <span>Showing {items.length} result{items.length !== 1 ? 's' : ''}.</span>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
