import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { ulid } from 'ulid';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminTable, AdminError, AdminEmptyRow } from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface CentreOption { id: string; name: string }

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
  /** False when the session's batch is outside the caller's write scope. */
  can_mark?: boolean;
}

type AttStatus = 'present' | 'absent' | 'late' | 'excused';
const ATT_STATUSES: AttStatus[] = ['present', 'absent', 'late', 'excused'];
/** Sentinel for "no observation recorded" — Radix Select cannot hold an empty value. */
const UNMARKED = '__unmarked__';

interface RosterRow {
  student_id: string;
  full_name: string;
  student_code: string;
  status: AttStatus | null;
  suggested_status?: AttStatus | null;
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

/** One page-level dialog — do not mount a Dialog root per table row (PERF #24). */
function MarkAttendanceDialog({
  centreId,
  sessionId,
  open,
  onOpenChange,
  onMarked,
}: {
  centreId: string;
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMarked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [statuses, setStatuses] = useState<Record<string, AttStatus>>({});
  /** Minted once per dialog open so a retry is the same submission (AT16). */
  const [submissionOpId, setSubmissionOpId] = useState<string>(() => ulid());

  useEffect(() => {
    if (!open || !sessionId) return;
    setLoading(true);
    setError(null);
    setDetail(null);
    setStatuses({});
    setSubmissionOpId(ulid());
    apiGet<SessionDetail>(
      `/v1/admin/attendance/centres/${centreId}/log?session_id=${encodeURIComponent(sessionId)}`,
    )
      .then((d) => {
        setDetail(d);
        // AT6 — silence is not absence, and it is not presence either. Only an
        // already-marked status or a pre-notified absence (AT4) seeds a value;
        // everyone else stays unmarked until the Guruji actually observes them.
        const init: Record<string, AttStatus> = {};
        for (const r of d.roster) {
          const seeded = r.status ?? r.suggested_status;
          if (seeded) init[r.student_id] = seeded;
        }
        setStatuses(init);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load roster.'))
      .finally(() => setLoading(false));
  }, [open, sessionId, centreId]);

  /** Only students the Guruji actually marked. AT6 — never infer the rest. */
  const marked = detail
    ? detail.roster.filter((r) => statuses[r.student_id] !== undefined)
    : [];

  async function submit() {
    if (!detail || !sessionId || marked.length === 0) return;
    setBusy(true);
    try {
      const markedAt = new Date().toISOString();
      await apiPost(`/v1/sessions/${sessionId}/attendance`, {
        // Stable for the life of this dialog: re-minting per click made a retry
        // after a timeout a second, non-idempotent submission (AT16).
        submission_op_id: submissionOpId,
        marked_at: markedAt,
        marks: marked.map((r) => ({
          student_id: r.student_id,
          status: statuses[r.student_id]!,
          client_op_id: ulid(),
        })),
      });
      toast.success(
        marked.length === detail.roster.length
          ? 'Attendance saved.'
          : `Attendance saved for ${marked.length} of ${detail.roster.length} students.`,
      );
      onOpenChange(false);
      onMarked();
    } catch (err) {
      toast.error('Failed to save attendance.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                          value={statuses[r.student_id] ?? UNMARKED}
                          onValueChange={(v) =>
                            setStatuses((prev) => {
                              const next = { ...prev };
                              if (v === UNMARKED) delete next[r.student_id];
                              else next[r.student_id] = v as AttStatus;
                              return next;
                            })
                          }
                        >
                          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNMARKED} className="text-muted-foreground">
                              Not marked
                            </SelectItem>
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
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                {/* Bulk helper: removing the present-default would otherwise turn a
                    routine full-attendance day into one click per student. */}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy || detail.roster.length === 0}
                  onClick={() =>
                    setStatuses((prev) => {
                      const next = { ...prev };
                      for (const r of detail.roster) {
                        // Never overwrite a pre-notified absence (AT4) — that is
                        // information the parent gave us, not a blank to fill.
                        if (r.suggested_status === 'excused' && next[r.student_id] === undefined) {
                          next[r.student_id] = 'excused';
                        } else if (next[r.student_id] === undefined) {
                          next[r.student_id] = 'present';
                        }
                      }
                      return next;
                    })
                  }
                >
                  Mark rest present
                </Button>
                <span className="text-xs text-muted-foreground">
                  {marked.length} of {detail.roster.length} marked
                </span>
              </div>
              <div className="flex gap-2">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="button" disabled={busy || marked.length === 0} onClick={submit}>
                  {busy ? 'Saving…' : 'Save attendance'}
                </Button>
              </div>
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
  const [centres, setCentres] = useState<CentreOption[]>([]);
  const [centreId, setCentreId] = useState('');
  const [items, setItems] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingSessionId, setMarkingSessionId] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ items: CentreOption[] }>('/v1/admin/centres')
      .then((r) => {
        const list = r?.items ?? [];
        setCentres(list);
        if (list[0]) setCentreId(list[0].id);
      })
      .catch(() => setError('Could not load centres.'));
  }, []);

  function reload() {
    if (!centreId) return;
    setLoading(true);
    setError(null);
    apiGet<{ items: SessionRow[] }>(`/v1/admin/attendance/centres/${centreId}/log?limit=100`)
      .then((r) => setItems(r?.items ?? []))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load log.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centreId]);

  return (
    <AdminPageShell
      title="Attendance"
      subtitle="Centre attendance log from materialised sessions (AT7). Mark via frozen POST /v1/sessions/:id/attendance."
      actions={
        <Select value={centreId} onValueChange={setCentreId}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Select centre" /></SelectTrigger>
          <SelectContent>
            {centres.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['Date', 'Batch', 'Centre', 'Status', 'Present / Total', 'GPS', 'Actions']}
        loading={loading}
        empty=""
        colSpan={7}
      >
        {items.length === 0 && !loading ? (
          <AdminEmptyRow colSpan={7} message="No sessions for this centre." />
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
              {centreId ? (
                s.can_mark === false ? (
                  // Disabled, not hidden — the Guruji should see the session
                  // exists and understand why they cannot mark it.
                  <span className="text-xs text-muted-foreground" title="This batch is assigned to another Guruji.">
                    Not your batch
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setMarkingSessionId(s.id)}
                  >
                    Mark
                  </Button>
                )
              ) : null}
            </td>
          </tr>
        ))}
      </AdminTable>
      {centreId ? (
        <MarkAttendanceDialog
          centreId={centreId}
          sessionId={markingSessionId}
          open={markingSessionId != null}
          onOpenChange={(open) => {
            if (!open) setMarkingSessionId(null);
          }}
          onMarked={reload}
        />
      ) : null}
    </AdminPageShell>
  );
}
