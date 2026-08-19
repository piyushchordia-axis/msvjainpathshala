/**
 * One shivir: sessions, volunteers, roster, export.
 *
 * The list rows used to be inert — no route from a shivir to anything, and no
 * way to hand a scanner to venue staff. Volunteer assignment in particular had
 * no UI at all on any surface, so the "registered volunteer" arm of the scan
 * authorization was unreachable and only admin-panel accounts could ever scan.
 *
 * Guarded at city_admin by inheritance: findNavItemForPath does longest-prefix,
 * so /admin/shivirs/:id picks up the /admin/shivirs nav entry's `min`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'wouter';
import { apiGet, apiPost, apiDelete, ApiError } from '@/lib/api-client';

import { toast } from '@/components/ui/toast-jp';
import {
  AdminPageShell,
  AdminTable,
  AdminError,
  AdminEmptyRow,
} from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Plus, Download, ExternalLink } from 'lucide-react';

/** Same base the api-client uses; the export links are plain <a> hrefs. */
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

interface SessionRow {
  id: string;
  title: string;
  day_number: number | null;
  session_date: string;
  start_time: string | null;
  end_time: string | null;
  attendance_mode: 'in_out' | 'present_only';
}

interface VolunteerRow {
  id: string;
  user_id: string;
  full_name: string;
  role: string;
  phone: string | null;
  role_label: string | null;
  assigned_at: string;
  revoked_at: string | null;
  is_active: boolean;
}

interface RosterRow {
  student_id: string;
  full_name: string;
  student_code: string | null;
  registered: boolean;
  last_scan_kind: 'present' | 'check_in' | 'check_out' | null;
  last_scanned_at: string | null;
  scan_count: number;
  state: 'registered' | 'scanned' | 'walk_in' | 'not_arrived';
}

interface StaffOption {
  id: string;
  full_name: string;
  role: string;
}

const STATE_LABEL: Record<RosterRow['state'], string> = {
  scanned: 'Attended',
  walk_in: 'Walk-in',
  not_arrived: 'Not arrived',
  registered: 'Registered',
};

function fmtDate(d: string): string {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB');
}

function AssignVolunteerDialog({ shivirId, onAdded }: { shivirId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [userId, setUserId] = useState('');
  const [roleLabel, setRoleLabel] = useState('');

  useEffect(() => {
    if (!open) return;
    // Both roles that can plausibly staff a venue. sanchalak is city_admin+
    // only, so a sanchalak assigning volunteers just gets the shikshak list.
    void Promise.all([
      apiGet<{ items: StaffOption[] }>('/v1/admin/users/pick?role=shikshak').catch(() => null),
      apiGet<{ items: StaffOption[] }>('/v1/admin/users/pick?role=sanchalak').catch(() => null),
    ]).then(([a, b]) => {
      const merged = [...(a?.items ?? []), ...(b?.items ?? [])];
      const seen = new Set<string>();
      setStaff(merged.filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true))));
    });
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    setBusy(true);
    try {
      await apiPost(`/v1/admin/shivirs/${shivirId}/volunteers`, {
        user_id: userId,
        role_label: roleLabel.trim() || undefined,
      });
      toast.success('Volunteer assigned.', 'They can now scan attendance for this shivir.');
      setOpen(false);
      setUserId('');
      setRoleLabel('');
      onAdded();
    } catch (err) {
      toast.error('Failed to assign volunteer.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Assign volunteer
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign a volunteer</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Staff member</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Select someone in your scope" />
              </SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.full_name} · {s.role.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Role at the venue (optional)</Label>
            <Input
              value={roleLabel}
              onChange={(e) => setRoleLabel(e.target.value)}
              placeholder="Gate scanning, registration desk…"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !userId}>
              {busy ? 'Assigning…' : 'Assign'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ShivirAdminDetailPage() {
  const params = useParams<{ id: string }>();
  const shivirId = params.id ?? '';

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [volunteers, setVolunteers] = useState<VolunteerRow[]>([]);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!shivirId) return;
    setLoading(true);
    setError(null);
    try {
      const [s, v, r] = await Promise.all([
        apiGet<{ items: SessionRow[] }>(`/v1/shivir-scanner/shivirs/${shivirId}/sessions`),
        apiGet<{ items: VolunteerRow[] }>(`/v1/admin/shivirs/${shivirId}/volunteers`),
        apiGet<{ items: RosterRow[] }>(`/v1/shivir-scanner/shivirs/${shivirId}/roster`),
      ]);
      setSessions(s?.items ?? []);
      setVolunteers(v?.items ?? []);
      setRoster(r?.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load this shivir.');
    } finally {
      setLoading(false);
    }
  }, [shivirId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(v: VolunteerRow) {
    try {
      await apiDelete(`/v1/admin/shivirs/${shivirId}/volunteers/${v.user_id}`);
      toast.success(
        `${v.full_name} can no longer scan.`,
        'Their existing scans stay on record.',
      );
      void load();
    } catch (err) {
      toast.error('Failed to revoke.', err instanceof ApiError ? err.message : undefined);
    }
  }

  const counts = useMemo(() => {
    const attended = roster.filter((r) => r.state === 'scanned').length;
    const walkIns = roster.filter((r) => r.state === 'walk_in').length;
    const missing = roster.filter((r) => r.state === 'not_arrived').length;
    return { attended, walkIns, missing };
  }, [roster]);

  return (
    <AdminPageShell
      title="Shivir"
      subtitle="Sessions, volunteers and who actually turned up."
      actions={
        <div className="flex gap-2">
          {/* Plain links, not fetch+blob: the export streams straight from the
              API with a Content-Disposition, so the browser handles it. */}
          <Button size="sm" variant="outline" asChild>
            <a href={`${API_BASE}/v1/admin/shivirs/${shivirId}/export?format=csv`}>
              <Download className="mr-1 h-4 w-4" />
              CSV
            </a>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={`${API_BASE}/v1/admin/shivirs/${shivirId}/export?format=pdf`}>
              <Download className="mr-1 h-4 w-4" />
              PDF
            </a>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/admin/shivir-dashboard">
              <ExternalLink className="mr-1 h-4 w-4" />
              Live dashboard
            </Link>
          </Button>
        </div>
      }
    >
      {error ? <AdminError message={error} /> : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Registered and attended</div>
          <div className="mt-1 text-2xl font-medium">{counts.attended}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Walk-ins (not registered)</div>
          <div className="mt-1 text-2xl font-medium">{counts.walkIns}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Registered, did not arrive</div>
          <div className="mt-1 text-2xl font-medium">{counts.missing}</div>
        </div>
      </div>

      <h2 className="mb-2 font-display text-lg text-secondary">Volunteers</h2>
      <div className="mb-2">
        <AssignVolunteerDialog shivirId={shivirId} onAdded={load} />
      </div>
      <AdminTable
        columns={['Name', 'Role', 'At the venue', 'Assigned', 'Status', '']}
        loading={loading}
        empty=""
        colSpan={6}
      >
        {volunteers.length === 0 && !loading ? (
          <AdminEmptyRow
            colSpan={6}
            message="Nobody is assigned yet — assign a volunteer so someone can scan at the venue."
          />
        ) : (
          volunteers.map((v) => (
            <tr key={v.id} className="hover:bg-muted/30">
              <td className="px-4 py-3 font-medium">{v.full_name}</td>
              <td className="px-4 py-3 capitalize">{v.role.replace(/_/g, ' ')}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{v.role_label ?? '—'}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {fmtDate(v.assigned_at)}
              </td>
              <td className="px-4 py-3">{v.is_active ? 'Active' : 'Revoked'}</td>
              <td className="px-4 py-3 text-right">
                {v.is_active ? (
                  <Button size="sm" variant="outline" onClick={() => void revoke(v)}>
                    Revoke
                  </Button>
                ) : null}
              </td>
            </tr>
          ))
        )}
      </AdminTable>

      <h2 className="mb-2 mt-8 font-display text-lg text-secondary">Sessions</h2>
      <AdminTable
        columns={['Day', 'Session', 'Date', 'Time', 'Mode']}
        loading={loading}
        empty=""
        colSpan={5}
      >
        {sessions.length === 0 && !loading ? (
          <AdminEmptyRow
            colSpan={5}
            message="No sessions yet — add one from the live dashboard before the shivir starts."
          />
        ) : (
          sessions.map((s) => (
            <tr key={s.id} className="hover:bg-muted/30">
              <td className="px-4 py-3">{s.day_number ?? '—'}</td>
              <td className="px-4 py-3 font-medium">{s.title}</td>
              <td className="px-4 py-3">{fmtDate(s.session_date)}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {s.start_time ? s.start_time.slice(0, 5) : '—'}
                {s.end_time ? `–${s.end_time.slice(0, 5)}` : ''}
              </td>
              <td className="px-4 py-3 capitalize">{s.attendance_mode.replace('_', ' ')}</td>
            </tr>
          ))
        )}
      </AdminTable>

      <h2 className="mb-2 mt-8 font-display text-lg text-secondary">Roster</h2>
      <AdminTable
        columns={['Student', 'Code', 'Status', 'Last scan', 'Scans']}
        loading={loading}
        empty=""
        colSpan={5}
      >
        {roster.length === 0 && !loading ? (
          <AdminEmptyRow
            colSpan={5}
            message="Nobody has registered or been scanned yet."
          />
        ) : (
          roster.map((r) => (
            <tr key={r.student_id} className="hover:bg-muted/30">
              <td className="px-4 py-3 font-medium">{r.full_name}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.student_code ?? '—'}</td>
              <td className="px-4 py-3">{STATE_LABEL[r.state]}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {r.last_scan_kind ? r.last_scan_kind.replace('_', ' ') : '—'}
                {r.last_scanned_at
                  ? ` · ${new Date(r.last_scanned_at).toLocaleTimeString('en-GB', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : ''}
              </td>
              <td className="px-4 py-3">{r.scan_count}</td>
            </tr>
          ))
        )}
      </AdminTable>
    </AdminPageShell>
  );
}
