import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearch } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth-context';
import { ROLE_PRECEDENCE, type Role } from '@/lib/auth';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '@/lib/api-client';
import type { JoinKind } from '@/lib/join';

type Stats = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  paid: number;
};

type Row = {
  id: string;
  display_code: string;
  name: string;
  has_paid: string;
  status: string;
  mobile?: string;
  parent_mobile?: string;
  whatsapp_contact?: string;
  centre_name?: string;
  city_name?: string;
  role?: string | null;
  photo_url?: string | null;
  payment_screenshot_url?: string | null;
  rejection_reason?: string | null;
  created_at: string;
};

type StatusFilter = 'pending' | 'approved' | 'rejected';

const ALL_KINDS: JoinKind[] = ['student', 'shikshak', 'sanchalak'];

function meetsMin(role: Role | undefined, min: Role): boolean {
  if (!role) return false;
  return ROLE_PRECEDENCE[role] >= ROLE_PRECEDENCE[min];
}

function kindsForRole(role: Role | undefined): JoinKind[] {
  if (!role) return [];
  if (role === 'shikshak') return ['student'];
  if (role === 'sanchalak') return ['student', 'shikshak'];
  if (meetsMin(role, 'city_admin')) return ALL_KINDS;
  return [];
}

export default function JoinAdminPage() {
  const search = useSearch();
  const { user } = useAuth();
  const allowedKinds = useMemo(() => kindsForRole(user?.role), [user?.role]);
  const kindParam = new URLSearchParams(search).get('kind');
  const kind: JoinKind = allowedKinds.includes(kindParam as JoinKind)
    ? (kindParam as JoinKind)
    : (allowedKinds[0] ?? 'student');

  const statusParam = new URLSearchParams(search).get('status') as StatusFilter | null;
  const status: StatusFilter =
    statusParam === 'approved' || statusParam === 'rejected' ? statusParam : 'pending';

  const canManageSettings = meetsMin(user?.role, 'city_admin');
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    if (!allowedKinds.length) return;
    setError(null);
    try {
      const [s, st, list] = await Promise.all([
        apiGet<{ registration_open: boolean }>(`/v1/join/settings?kind=${kind}`),
        apiGet<Stats>(`/v1/join/registrations/stats?kind=${kind}`),
        apiGet<{ items: Row[] }>(
          `/v1/join/registrations?kind=${kind}&status=${status}${
            q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''
          }`,
        ),
      ]);
      setOpen(s.registration_open);
      setStats(st);
      setItems(list.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load');
    }
  }, [allowedKinds.length, kind, status, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleOpen = async () => {
    setBusy(true);
    try {
      await apiPut(`/v1/join/settings/registration_open?kind=${kind}`, {
        value: open ? 'no' : 'yes',
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const approve = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/v1/join/registrations/${id}/approve?kind=${kind}`, {});
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Approve failed');
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!rejectId || !rejectReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/v1/join/registrations/${rejectId}/reject?kind=${kind}`, {
        reason: rejectReason.trim(),
      });
      setRejectId(null);
      setRejectReason('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Reject failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this registration?')) return;
    setBusy(true);
    try {
      await apiDelete(`/v1/join/registrations/${id}?kind=${kind}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  if (!allowedKinds.length) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">You do not have access to join approvals.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-secondary">Join approvals</h1>
          <p className="text-sm text-muted-foreground">
            Review pending registrations and provision accounts on approve.
          </p>
        </div>
        {canManageSettings ? (
          <Button variant="outline" disabled={busy} onClick={() => void toggleOpen()}>
            Registration {open ? 'open' : 'closed'} — click to toggle
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {allowedKinds.map((k) => (
          <Button key={k} asChild variant={k === kind ? 'default' : 'outline'} size="sm">
            <Link href={`/admin/join?kind=${k}&status=${status}`}>{k}</Link>
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(['pending', 'approved', 'rejected'] as const).map((s) => (
          <Button key={s} asChild variant={s === status ? 'default' : 'outline'} size="sm">
            <Link href={`/admin/join?kind=${kind}&status=${s}`}>
              {s}
              {stats ? ` (${s === 'pending' ? stats.pending : s === 'approved' ? stats.approved : stats.rejected})` : ''}
            </Link>
          </Button>
        ))}
      </div>

      {stats ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-4 text-sm">Total {stats.total}</Card>
          <Card className="p-4 text-sm">Pending {stats.pending}</Card>
          <Card className="p-4 text-sm">Approved {stats.approved}</Card>
        </div>
      ) : null}

      <div className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, code, phone…"
          className="max-w-sm"
        />
        <Button variant="outline" onClick={() => void load()} disabled={busy}>
          Search
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-3">Code</th>
              <th className="p-3">Name</th>
              <th className="p-3">Contact</th>
              <th className="p-3">Centre</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="p-3 font-mono text-xs">{row.display_code}</td>
                <td className="p-3">
                  <div>{row.name}</div>
                  {row.role ? <div className="text-xs text-muted-foreground">{row.role}</div> : null}
                </td>
                <td className="p-3 font-mono text-xs">
                  {row.parent_mobile ?? row.mobile ?? row.whatsapp_contact ?? '—'}
                </td>
                <td className="p-3">
                  <div>{row.centre_name ?? '—'}</div>
                  <div className="text-xs text-muted-foreground">{row.city_name}</div>
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-2">
                    {status === 'pending' ? (
                      <>
                        <Button size="sm" disabled={busy} onClick={() => void approve(row.id)}>
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setRejectId(row.id);
                            setRejectReason('');
                          }}
                        >
                          Reject
                        </Button>
                      </>
                    ) : null}
                    {row.rejection_reason ? (
                      <span className="text-xs text-muted-foreground">{row.rejection_reason}</span>
                    ) : null}
                    {canManageSettings ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void remove(row.id)}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  No registrations in this queue.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {rejectId ? (
        <Card className="max-w-md space-y-3 p-4">
          <h2 className="font-medium">Reject registration</h2>
          <Input
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason (required)"
          />
          <div className="flex gap-2">
            <Button disabled={busy || !rejectReason.trim()} onClick={() => void reject()}>
              Confirm reject
            </Button>
            <Button variant="outline" onClick={() => setRejectId(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
