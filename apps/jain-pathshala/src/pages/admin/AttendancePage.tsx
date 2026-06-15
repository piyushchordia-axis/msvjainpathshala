import { useEffect, useState } from 'react';
import { Plus, MapPin } from 'lucide-react';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { useAdminList } from '@/hooks/useAdminList';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminTable, AdminError, AdminEmptyRow } from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface SessionRow {
  id: string;
  session_date: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  topic: string | null;
  gps_required: boolean;
  batch_id: string;
  batch_name: string;
  centre_name: string;
  present_count: number;
  total_count: number;
}

interface BatchOption { id: string; name: string | null; centre_name: string; }

type AttStatus = 'present' | 'absent' | 'late' | 'excused';
const ATT_STATUSES: AttStatus[] = ['present', 'absent', 'late', 'excused'];

interface RosterRow {
  student_id: string;
  full_name: string;
  student_code: string;
  status: AttStatus | null;
  marked_method: 'manual' | 'gps' | null;
}

interface SessionDetail {
  session: {
    id: string;
    batch_id: string;
    session_date: string;
    status: string;
    topic: string | null;
    gps_required: boolean;
    batch_name: string;
    centre_name: string;
    has_gps: boolean;
  };
  roster: RosterRow[];
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs font-medium">{label}</Label>{children}</div>;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function NewSessionDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [batchId, setBatchId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [topic, setTopic] = useState('');
  const [gpsRequired, setGpsRequired] = useState(false);

  useEffect(() => {
    if (!open) return;
    void apiGet<{ items: BatchOption[] }>('/v1/admin/batches').then((r) => setBatches(r?.items ?? []));
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!batchId || !date) return;
    setBusy(true);
    try {
      await apiPost('/v1/attendance/sessions', {
        batch_id: batchId,
        session_date: date,
        topic: topic.trim() || undefined,
        gps_required: gpsRequired,
      });
      toast.success('Session created.');
      setOpen(false);
      setBatchId(''); setDate(todayStr()); setTopic(''); setGpsRequired(false);
      onAdded();
    } catch (err) {
      toast.error('Failed to create session.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />New session</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Create session</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Batch *">
            <Select value={batchId} onValueChange={setBatchId}>
              <SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger>
              <SelectContent>
                {batches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {(b.name || 'Unnamed batch')} — {b.centre_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Session date *">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </FormRow>
          <FormRow label="Topic">
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Optional topic" maxLength={200} />
          </FormRow>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={gpsRequired} onCheckedChange={(v) => setGpsRequired(v === true)} />
            <span>Require GPS geofence when marking</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !batchId || !date}>{busy ? 'Saving…' : 'Create session'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MarkDialog({ sessionId, gpsRequired, onMarked }: { sessionId: string; gpsRequired: boolean; onMarked: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [statuses, setStatuses] = useState<Record<string, AttStatus>>({});
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setCoords(null);
    apiGet<SessionDetail>(`/v1/attendance/sessions/${sessionId}`)
      .then((d) => {
        setDetail(d);
        const init: Record<string, AttStatus> = {};
        for (const r of d.roster) init[r.student_id] = r.status ?? 'present';
        setStatuses(init);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load roster.'))
      .finally(() => setLoading(false));
  }, [open, sessionId]);

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not available in this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
        toast.success('Location captured.');
      },
      (err) => {
        setLocating(false);
        toast.error('Could not get location.', err?.message);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function submit() {
    if (!detail) return;
    if (gpsRequired && !coords) {
      toast.warning('This session requires your location. Tap “Use my location” first.');
      return;
    }
    setBusy(true);
    try {
      const records = detail.roster.map((r) => ({ student_id: r.student_id, status: statuses[r.student_id] ?? 'present' }));
      await apiPost(`/v1/attendance/sessions/${sessionId}/mark`, {
        records,
        ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
      });
      toast.success('Attendance saved.');
      setOpen(false);
      onMarked();
    } catch (err) {
      toast.error('Failed to save attendance.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">Mark</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {detail ? `Mark attendance — ${detail.session.batch_name}` : 'Mark attendance'}
          </DialogTitle>
        </DialogHeader>
        {error ? <AdminError message={error} /> : null}
        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading roster…</div>
        ) : detail ? (
          <div className="space-y-4 pt-1">
            {(detail.session.gps_required || detail.session.has_gps) ? (
              <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="text-xs text-muted-foreground">
                  {detail.session.gps_required
                    ? 'GPS is required to mark this session.'
                    : 'GPS is optional for this session.'}
                  {coords ? <span className="ml-2 text-emerald-700">Location captured.</span> : null}
                </div>
                <Button type="button" size="sm" variant="outline" disabled={locating} onClick={useMyLocation}>
                  <MapPin className="mr-1 h-4 w-4" />{locating ? 'Locating…' : 'Use my location'}
                </Button>
              </div>
            ) : null}

            <div className="max-h-72 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Student</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {detail.roster.length === 0 ? (
                    <tr><td colSpan={2} className="px-3 py-6 text-center text-muted-foreground">No active students in this batch.</td></tr>
                  ) : detail.roster.map((r) => (
                    <tr key={r.student_id} className="hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.full_name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{r.student_code}</div>
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={statuses[r.student_id] ?? 'present'}
                          onValueChange={(v) => setStatuses((prev) => ({ ...prev, [r.student_id]: v as AttStatus }))}
                        >
                          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ATT_STATUSES.map((s) => (
                              <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2">
              <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              <Button type="button" disabled={busy || detail.roster.length === 0} onClick={submit}>
                {busy ? 'Saving…' : 'Save attendance'}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function statusBadgeClass(status: SessionRow['status']): string {
  switch (status) {
    case 'completed': return 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700';
    case 'cancelled': return 'rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive';
    case 'in_progress': return 'rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700';
    default: return 'rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground';
  }
}

export default function AttendancePage() {
  const { items, loading, error, reload } = useAdminList<SessionRow>('/v1/attendance/sessions?limit=100');

  return (
    <AdminPageShell
      title="Attendance"
      subtitle="Sessions and attendance across your centres, with optional GPS geofencing."
      actions={<NewSessionDialog onAdded={reload} />}
    >
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['Date', 'Batch', 'Centre', 'Status', 'Present / Total', 'GPS', 'Actions']}
        loading={loading}
        empty=""
        colSpan={7}
      >
        {items.length === 0 && !loading ? (
          <AdminEmptyRow colSpan={7} message="No sessions yet." />
        ) : null}
        {items.map((s) => (
          <tr key={s.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">
              {new Date(s.session_date).toLocaleDateString('en-GB')}
            </td>
            <td className="px-4 py-3">
              <div>{s.batch_name}</div>
              {s.topic ? <div className="text-xs text-muted-foreground">{s.topic}</div> : null}
            </td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{s.centre_name}</td>
            <td className="px-4 py-3"><span className={statusBadgeClass(s.status)}>{s.status}</span></td>
            <td className="px-4 py-3">{s.present_count} / {s.total_count}</td>
            <td className="px-4 py-3">
              {s.gps_required ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                  <MapPin className="h-3 w-3" />GPS
                </span>
              ) : <span className="text-xs text-muted-foreground">—</span>}
            </td>
            <td className="px-4 py-3">
              <MarkDialog sessionId={s.id} gpsRequired={s.gps_required} onMarked={reload} />
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}
