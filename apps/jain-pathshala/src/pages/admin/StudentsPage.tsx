import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { ageGroupFromDob, formatAgeGroup } from '@workspace/api-zod';
import { toast } from '@/components/ui/toast-jp';
import { Textarea } from '@/components/ui/textarea';
import { AdminLoadMore } from '@/components/admin/AdminPageShell';
import { useAdminList } from '@/hooks/useAdminList';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
const GUARDIAN_RELATIONS = [
  { value: 'father', label: 'Father' },
  { value: 'mother', label: 'Mother' },
  { value: 'guardian', label: 'Guardian' },
] as const;

interface AdminStudentRow {
  id: string;
  full_name: string | null;
  student_code: string;
  age_group: string;
  dob: string | null;
  msv_status: string;
  status: 'active' | 'inactive';
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return raw.trim();
}

function StatusPill({ status }: { status: string }) {
  const active = status === 'active';
  return (
    <span
      className={
        active
          ? 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700'
          : 'rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground'
      }
    >
      {status}
    </span>
  );
}

/**
 * Designed deactivation dialog (SAN-ERR-02, SAN-DSN-02): the old
 * `window.prompt` reason was unstyled, and until the server fix it was also
 * silently discarded. Deactivation is Q11 — the student stays on record and
 * can be reactivated any time.
 */
function DeactivateStudentDialog({
  id,
  name,
  onChanged,
}: {
  id: string;
  name: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await apiPost(`/v1/admin/students/${id}/status`, {
        action: 'deactivate',
        reason: trimmed,
      });
      toast.success('Student deactivated.', 'They stay on record and can be reactivated any time.');
      setOpen(false);
      setReason('');
      onChanged();
    } catch (err) {
      toast.error('Could not deactivate student.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setReason(''); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">Deactivate</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Deactivate {name}</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <p className="text-sm text-muted-foreground">
            The student is removed from active rosters and leaderboards but stays on record —
            you can reactivate them at any time.
          </p>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Reason * (kept in the audit trail)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="e.g. Family moved to another city"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" variant="secondary" disabled={busy || !trimmed}>
              {busy ? 'Deactivating…' : 'Deactivate'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StudentRowActions({
  id,
  name,
  status,
  onChanged,
}: {
  id: string;
  name: string;
  status: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function reactivate() {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost(`/v1/admin/students/${id}/status`, { action: 'reactivate' });
      toast.success('Student reactivated.');
      onChanged();
    } catch (err) {
      toast.error('Could not reactivate student.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  if (status === 'active') {
    return <DeactivateStudentDialog id={id} name={name} onChanged={onChanged} />;
  }
  return (
    <Button size="sm" variant="ghost" disabled={busy} onClick={reactivate}>
      Reactivate
    </Button>
  );
}

interface CentreOpt { id: string; name: string; }
interface BatchOpt { id: string; name: string; centre_id: string; }

function AddStudentDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [centres, setCentres] = useState<CentreOpt[]>([]);
  const [batches, setBatches] = useState<BatchOpt[]>([]);
  const [fullName, setFullName] = useState('');
  const [centreId, setCentreId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [gender, setGender] = useState('');
  const [dob, setDob] = useState('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [guardianRelation, setGuardianRelation] = useState<'father' | 'mother' | 'guardian'>('father');
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');

  useEffect(() => {
    if (!open) return;
    void apiGet<{ items: CentreOpt[] }>('/v1/admin/centres').then((r) => setCentres(r?.items ?? []));
    void apiGet<{ items: BatchOpt[] }>('/v1/admin/batches').then((r) => setBatches(r?.items ?? []));
  }, [open]);

  const filteredBatches = centreId ? batches.filter((b) => b.centre_id === centreId) : batches;
  const derivedAgeGroup = dob ? ageGroupFromDob(dob) : null;

  function resetForm() {
    setFullName('');
    setCentreId('');
    setBatchId('');
    setGender('');
    setDob('');
    setBloodGroup('');
    setGuardianRelation('father');
    setParentName('');
    setParentPhone('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const phone = normalizePhone(parentPhone);
    if (!fullName.trim() || !centreId || !dob || !parentName.trim() || !phone.startsWith('+')) {
      toast.error('Fill student name, centre, date of birth, and parent name + phone.');
      return;
    }
    if (!derivedAgeGroup) {
      toast.error('Date of birth must be between 5 and 21 years of age.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ student_code: string; parent_created?: boolean }>(
        '/v1/admin/students',
        {
          full_name: fullName.trim(),
          centre_id: centreId,
          batch_id: batchId || undefined,
          gender: gender || undefined,
          dob,
          blood_group: bloodGroup || undefined,
          parent_full_name: parentName.trim(),
          parent_phone: phone,
          guardian_relation: guardianRelation,
        },
      );
      toast.success(
        res.parent_created
          ? `Student registered (${res.student_code}). Parent login created.`
          : `Student registered (${res.student_code}). Linked to existing parent.`,
      );
      setOpen(false);
      resetForm();
      onAdded();
    } catch (err) {
      toast.error('Failed to register student.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    !!fullName.trim() &&
    !!centreId &&
    !!dob &&
    !!derivedAgeGroup &&
    !!parentName.trim() &&
    !!parentPhone.trim();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />Add student</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Register student</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Full name *</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Centre *</Label>
            <Select value={centreId} onValueChange={(v) => { setCentreId(v); setBatchId(''); }}>
              <SelectTrigger><SelectValue placeholder="Select centre" /></SelectTrigger>
              <SelectContent>
                {centres.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Date of birth *</Label>
              <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Age group</Label>
              <Input
                readOnly
                value={dob ? (derivedAgeGroup ? formatAgeGroup(derivedAgeGroup) : 'Outside 5–21 yrs') : 'From date of birth'}
                className="bg-muted"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Batch (optional)</Label>
            <Select value={batchId} onValueChange={setBatchId} disabled={filteredBatches.length === 0}>
              <SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger>
              <SelectContent>
                {filteredBatches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Gender</Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Blood group</Label>
              <Select value={bloodGroup} onValueChange={setBloodGroup}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {BLOOD_GROUPS.map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md border border-border/70 p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Parent / guardian login
            </p>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Relation *</Label>
              <Select
                value={guardianRelation}
                onValueChange={(v) => setGuardianRelation(v as 'father' | 'mother' | 'guardian')}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GUARDIAN_RELATIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Name *</Label>
              <Input
                value={parentName}
                onChange={(e) => setParentName(e.target.value)}
                placeholder="Parent / guardian full name"
                required
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Mobile *</Label>
              <Input
                value={parentPhone}
                onChange={(e) => setParentPhone(e.target.value)}
                placeholder="+91 98XXXXXXXX"
                inputMode="tel"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                They can sign in with this number (OTP) to manage the student.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !canSubmit}>
              {busy ? 'Saving…' : 'Register'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const STUDENT_STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
] as const;

export default function StudentsPage() {
  // Server search + status filter + cursor paging (SAN-API-07): the page used
  // to show a fixed first 100 with no way to find a deactivated student.
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const listUrl = (() => {
    const params = new URLSearchParams({ limit: '100' });
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    return `/v1/admin/students?${params.toString()}`;
  })();

  const { items, loading, loadingMore, error, reload, hasMore, loadMore } =
    useAdminList<AdminStudentRow>(listUrl);
  const load = () => void reload();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">Students</h2>
          <p className="text-sm text-muted-foreground">
            Roster across your centres and batches. Inactive students stay on record.
          </p>
        </div>
        <AddStudentDialog onAdded={load} />
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or student code…"
          className="h-9 w-64"
        />
        {STUDENT_STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={[
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground hover:bg-muted',
              ].join(' ')}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Age group</th>
                <th className="px-4 py-3">DOB</th>
                <th className="px-4 py-3">MSV</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Loading students…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No students in scope yet.
                  </td>
                </tr>
              ) : (
                items.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{s.full_name || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {s.student_code}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatAgeGroup(s.age_group)}
                    </td>
                    <td className="px-4 py-3 text-xs">{s.dob ?? '—'}</td>
                    <td className="px-4 py-3">
                      {s.msv_status === 'approved' ? (
                        <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">MSV</Badge>
                      ) : s.msv_status && s.msv_status !== 'none' ? (
                        <span className="text-xs text-muted-foreground">{s.msv_status}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={s.status} />
                    </td>
                    <td className="px-4 py-3">
                      <StudentRowActions
                        id={s.id}
                        name={s.full_name ?? s.student_code}
                        status={s.status}
                        onChanged={load}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border bg-muted/30 px-4 py-2">
          <AdminLoadMore hasMore={hasMore} loadingMore={loadingMore} onLoadMore={() => void loadMore()} />
        </div>
      </Card>
    </div>
  );
}
