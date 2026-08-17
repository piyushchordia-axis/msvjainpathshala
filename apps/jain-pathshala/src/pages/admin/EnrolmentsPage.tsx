import { useEffect, useMemo, useState } from 'react';
import { Link, useSearch } from 'wouter';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast-jp';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { AdminLoadMore } from '@/components/admin/AdminPageShell';
import { useAdminList } from '@/hooks/useAdminList';
import { REJECT_REASON_MIN, REJECT_REASON_MAX } from '@workspace/api-zod';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';

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

const REJECT_PRESETS = [
  'Batch is full for this age group this term.',
  'The requested batch does not match this age group.',
  'Documents are incomplete — please re-apply with the missing details.',
];

/**
 * Designed reject dialog with the shared 10–300 bounds (SAN-API-03,
 * SAN-DSN-02): the old `window.prompt` accepted "x" and sent it to the
 * parent.
 */
function RejectEnrolmentDialog({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');

  const trimmed = reason.trim();
  const valid = trimmed.length >= REJECT_REASON_MIN && trimmed.length <= REJECT_REASON_MAX;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await apiPost(`/v1/admin/enrolments/${id}/reject`, { reason: trimmed });
      toast.success('Enrolment rejected.');
      setOpen(false);
      setReason('');
      onChanged();
    } catch (err) {
      toast.error('Could not reject.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setReason(''); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">Reject</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Reject enrolment</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <div className="space-y-1">
            <Label className="text-xs font-medium">
              Reason * (at least {REJECT_REASON_MIN} characters — the parent will read it)
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={REJECT_REASON_MAX}
              placeholder="Why is this enrolment being rejected?"
            />
            <p className={`text-xs ${valid || trimmed.length === 0 ? 'text-muted-foreground' : 'text-destructive'}`}>
              {trimmed.length}/{REJECT_REASON_MAX}
              {trimmed.length > 0 && trimmed.length < REJECT_REASON_MIN
                ? ` — at least ${REJECT_REASON_MIN} characters`
                : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {REJECT_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/40"
                onClick={() => setReason(p)}
              >
                {p.slice(0, 34)}…
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" variant="secondary" disabled={busy || !valid}>
              {busy ? 'Rejecting…' : 'Reject'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DecideActions({ id, status, onChanged }: DecideActionsProps) {
  const [busy, setBusy] = useState<string | null>(null);

  async function act(action: 'approve' | 'waitlist') {
    if (busy) return;
    setBusy(action);
    try {
      await apiPost(`/v1/admin/enrolments/${id}/${action}`, {});
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
      {/* Approve is valid from both pending and waitlisted. */}
      <Button size="sm" onClick={() => act('approve')} disabled={!!busy}>
        {busy === 'approve' ? '…' : 'Approve'}
      </Button>
      {status === 'pending' ? (
        <Button size="sm" variant="outline" onClick={() => act('waitlist')} disabled={!!busy}>
          {busy === 'waitlist' ? '…' : 'Waitlist'}
        </Button>
      ) : null}
      <RejectEnrolmentDialog id={id} onChanged={onChanged} />
    </div>
  );
}

interface StudentOption { id: string; full_name: string | null; student_code: string; }
interface BatchOption { id: string; name: string | null; centre_name: string; status: 'active' | 'inactive'; }

function batchLabel(b: BatchOption): string {
  return `${b.name ?? '—'} · ${b.centre_name}`;
}

function studentLabel(s: StudentOption): string {
  return `${s.full_name ?? '—'} · ${s.student_code}`;
}

/**
 * Server-searched student picker (SAN-API-04): the old version client-filtered
 * one default page, so a student late in the alphabet showed "No matching
 * student" even though they exist.
 */
function StudentSearchSelect({
  value,
  selected,
  onChange,
  disabled,
}: {
  value: string;
  selected: StudentOption | null;
  onChange: (student: StudentOption) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StudentOption[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    const t = window.setTimeout(() => {
      const url = q
        ? `/v1/admin/students?limit=20&q=${encodeURIComponent(q)}`
        : '/v1/admin/students?limit=20';
      setSearching(true);
      apiGet<{ items: StudentOption[] }>(url)
        .then((r) => setResults(r?.items ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => window.clearTimeout(t);
  }, [open, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-9 w-full justify-between font-normal"
        >
          <span className="truncate text-left">
            {selected ? studentLabel(selected) : 'Search student…'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[100] w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by name or student code…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{searching ? 'Searching…' : 'No matching student.'}</CommandEmpty>
            <CommandGroup>
              {results.map((s) => (
                <CommandItem
                  key={s.id}
                  value={s.id}
                  onSelect={() => {
                    onChange(s);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === s.id ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="truncate">
                    <span className="font-medium">{s.full_name ?? '—'}</span>
                    <span className="ml-1 font-mono text-xs text-muted-foreground">
                      {s.student_code}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function BatchSearchSelect({
  batches,
  value,
  onChange,
  disabled,
  loading,
}: {
  batches: BatchOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => batches.find((b) => b.id === value) ?? null, [batches, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className="h-9 w-full justify-between font-normal"
        >
          <span className="truncate text-left">
            {loading
              ? 'Loading…'
              : selected
                ? batchLabel(selected)
                : 'Search batch…'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[100] w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search by batch or centre…" />
          <CommandList>
            <CommandEmpty>No matching batch.</CommandEmpty>
            <CommandGroup>
              {batches.map((b) => {
                const label = batchLabel(b);
                return (
                  <CommandItem
                    key={b.id}
                    value={label}
                    onSelect={() => {
                      onChange(b.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === b.id ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="truncate">{label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function AddEnrolmentDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [student, setStudent] = useState<StudentOption | null>(null);
  const [batchId, setBatchId] = useState('');
  const [approveNow, setApproveNow] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoadingOpts(true);
    apiGet<{ items: BatchOption[] }>('/v1/admin/batches')
      .then((b) => {
        // Only active batches can accept enrolments.
        setBatches((b?.items ?? []).filter((x) => x.status === 'active'));
      })
      .catch((err) => toast.error('Could not load batches.', err instanceof ApiError ? err.message : undefined))
      .finally(() => setLoadingOpts(false));
  }, [open]);

  function reset() {
    setStudent(null); setBatchId(''); setApproveNow(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!student || !batchId) return;
    setBusy(true);
    try {
      await apiPost('/v1/enrolments', {
        student_id: student.id,
        requested_batch_id: batchId,
        ...(approveNow ? { auto_approve: true } : {}),
      });
      toast.success(approveNow ? 'Student enrolled and approved.' : 'Enrolment request created.');
      setOpen(false);
      reset();
      onAdded();
    } catch (err) {
      toast.error('Could not create enrolment.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />Add enrolment</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add enrolment</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Student *</Label>
            <StudentSearchSelect
              value={student?.id ?? ''}
              selected={student}
              onChange={setStudent}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Batch *</Label>
            <BatchSearchSelect
              batches={batches}
              value={batchId}
              onChange={setBatchId}
              loading={loadingOpts}
              disabled={loadingOpts}
            />
            {!loadingOpts && batches.length === 0 ? (
              <p className="text-xs text-muted-foreground">No active batches in your scope.</p>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={approveNow}
              onChange={(e) => setApproveNow(e.target.checked)}
            />
            <span>Enrol &amp; approve now (attach the student immediately)</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !student || !batchId}>
              {busy ? 'Saving…' : approveNow ? 'Enrol & approve' : 'Create request'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function EnrolmentsPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const statusFilter = (params.get('status') as EnrolmentStatus | null) ?? 'all';

  // Cursor-paged (SAN-PRF-03): the list used to end silently at the limit.
  const listUrl =
    statusFilter !== 'all'
      ? `/v1/admin/enrolments?limit=100&status=${statusFilter}`
      : '/v1/admin/enrolments?limit=100';
  const { items, loading, loadingMore, error, reload, hasMore, loadMore } =
    useAdminList<EnrolmentRow>(listUrl);
  const load = () => void reload();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">Enrolments</h2>
          <p className="text-sm text-muted-foreground">Create requests, then approve, waitlist, or reject pending applications.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddEnrolmentDialog onAdded={load} />
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
            <AdminLoadMore hasMore={hasMore} loadingMore={loadingMore} onLoadMore={() => void loadMore()} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
