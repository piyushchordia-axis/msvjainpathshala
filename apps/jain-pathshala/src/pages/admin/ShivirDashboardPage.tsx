import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScanLine, RefreshCw, Plus, Wifi, WifiOff } from 'lucide-react';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminTable, AdminError, AdminEmptyRow } from '@/components/admin/AdminPageShell';
import { useShivirLiveFeed } from '@/hooks/useShivirLiveFeed';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';

interface ShivirRow {
  id: string;
  name_en: string;
  name_hi: string | null;
  city_name: string;
  start_date: string;
  end_date: string;
}

interface SessionCountRow {
  id: string;
  title: string;
  session_date: string;
  attendance_mode: string;
  present: number;
  checked_in: number;
  checked_out: number;
  distinct_students: number;
  /** Scanned without a registration — allowed, but the venue should see it. */
  walk_ins: number;
}

interface DashboardData {
  sessions: SessionCountRow[];
  registered_total: number;
  cancelled_total: number;
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

function NewSessionDialog({ shivirId, onAdded }: { shivirId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [sessionDate, setSessionDate] = useState('');
  const [mode, setMode] = useState('present_only');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !sessionDate) return;
    setBusy(true);
    try {
      await apiPost(`/v1/shivir-scanner/shivirs/${shivirId}/sessions`, {
        title: title.trim(),
        session_date: sessionDate,
        attendance_mode: mode,
      });
      toast.success('Session created.');
      setOpen(false);
      setTitle('');
      setSessionDate('');
      setMode('present_only');
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
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          New session
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create session</DialogTitle>
        </DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Title *">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </FormRow>
          <FormRow label="Session date *">
            <Input
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              required
            />
          </FormRow>
          <FormRow label="Attendance mode">
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="present_only">Present only</option>
              <option value="in_out">Check in / out</option>
            </select>
          </FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !title.trim() || !sessionDate}>
              {busy ? 'Saving…' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ShivirDashboardPage() {
  const [shivirs, setShivirs] = useState<ShivirRow[]>([]);
  const [shivirsLoading, setShivirsLoading] = useState(true);
  const [shivirsError, setShivirsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');

  const [dash, setDash] = useState<DashboardData | null>(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [dashError, setDashError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setShivirsLoading(true);
    apiGet<{ items: ShivirRow[] }>('/v1/admin/shivirs?limit=200')
      .then((res) => {
        if (!active) return;
        const items = res?.items ?? [];
        setShivirs(items);
        setSelectedId((prev) => prev || (items[0]?.id ?? ''));
      })
      .catch((err) => {
        if (active) setShivirsError(err instanceof ApiError ? err.message : 'Failed to load shivirs.');
      })
      .finally(() => {
        if (active) setShivirsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  /**
   * `seq` is the stale-response guard. With a live feed the dashboard reloads
   * on every scan, so slow and fast responses genuinely overlap — without it
   * an older payload can land last and roll the counts backwards.
   */
  const seq = useRef(0);
  const loadDashboard = useCallback(
    async (shivirId: string, opts: { quiet?: boolean } = {}) => {
      if (!shivirId) {
        setDash(null);
        return;
      }
      const mine = ++seq.current;
      // A background refresh must not flash the table into its loading state.
      if (!opts.quiet) setDashLoading(true);
      setDashError(null);
      try {
        const res = await apiGet<DashboardData>(`/v1/shivir-scanner/shivirs/${shivirId}/dashboard`);
        if (seq.current !== mine) return;
        setDash(res);
      } catch (err) {
        if (seq.current !== mine) return;
        setDashError(err instanceof ApiError ? err.message : 'Failed to load dashboard.');
        setDash(null);
      } finally {
        if (seq.current === mine && !opts.quiet) setDashLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadDashboard(selectedId);
  }, [selectedId, loadDashboard]);

  const onScan = useCallback(() => {
    void loadDashboard(selectedId, { quiet: true });
  }, [loadDashboard, selectedId]);
  const live = useShivirLiveFeed(selectedId, onScan);

  const selected = useMemo(
    () => shivirs.find((s) => s.id === selectedId) ?? null,
    [shivirs, selectedId],
  );

  return (
    <AdminPageShell
      title="Shivir Attendance"
      subtitle="Live QR-scan attendance counts per session for a shivir in your scope."
      actions={
        selectedId ? <NewSessionDialog shivirId={selectedId} onAdded={() => loadDashboard(selectedId)} /> : undefined
      }
    >
      {shivirsError ? <AdminError message={shivirsError} /> : null}

      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[280px] flex-1 space-y-1">
            <Label className="text-xs font-medium">Shivir</Label>
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={shivirsLoading || shivirs.length === 0}
            >
              {shivirsLoading ? (
                <option value="">Loading…</option>
              ) : shivirs.length === 0 ? (
                <option value="">No shivirs available</option>
              ) : (
                shivirs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name_en} — {s.city_name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadDashboard(selectedId)}
              disabled={!selectedId || dashLoading}
            >
              <RefreshCw className={'mr-1 h-4 w-4 ' + (dashLoading ? 'animate-spin' : '')} />
              Refresh
            </Button>
            {dash ? (
              <span className="text-sm text-muted-foreground">
                Registered: <span className="font-medium text-foreground">{dash.registered_total}</span>
              </span>
            ) : null}
            {/* Honest about the transport: a dashboard that says "Live" while
                silently polling is the drift this whole page had. */}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {live.connected ? (
                <>
                  <Wifi className="h-3.5 w-3.5 text-emerald-600" /> Live
                </>
              ) : (
                <>
                  <WifiOff className="h-3.5 w-3.5" /> Refreshing every 10s
                </>
              )}
            </span>
          </div>
        </div>
        {selected ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <ScanLine className="h-4 w-4" />
            {new Date(selected.start_date).toLocaleDateString('en-GB')} –{' '}
            {new Date(selected.end_date).toLocaleDateString('en-GB')}
          </div>
        ) : null}
      </Card>

      {dashError ? <AdminError message={dashError} /> : null}

      <AdminTable
        columns={['Session', 'Date', 'Mode', 'Attendance', 'Distinct students', 'Walk-ins']}
        loading={dashLoading}
        empty=""
        colSpan={6}
      >
        {dash && dash.sessions.length === 0 && !dashLoading ? (
          <AdminEmptyRow colSpan={6} message="No sessions yet for this shivir." />
        ) : null}
        {(dash?.sessions ?? []).map((s) => (
          <tr key={s.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">{s.title}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">
              {new Date(s.session_date).toLocaleDateString('en-GB')}
            </td>
            <td className="px-4 py-3 text-xs capitalize">{s.attendance_mode.replace('_', ' ')}</td>
            {/* Only the counts this mode can produce. Rendering all four put
                three permanent zeros next to every present_only session. */}
            <td className="px-4 py-3">
              {s.attendance_mode === 'present_only' ? (
                <span>{s.present} present</span>
              ) : (
                <span>
                  {s.checked_in} in · {s.checked_out} out
                  {s.checked_in - s.checked_out > 0 ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({s.checked_in - s.checked_out} still inside)
                    </span>
                  ) : null}
                </span>
              )}
            </td>
            <td className="px-4 py-3 font-medium">{s.distinct_students}</td>
            <td className="px-4 py-3">{s.walk_ins}</td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}
