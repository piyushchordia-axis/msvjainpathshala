import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { AGE_GROUPS, formatAgeGroup } from '@workspace/api-zod';
import { toast } from '@/components/ui/toast-jp';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface AdminStudentRow {
  id: string;
  full_name: string | null;
  student_code: string;
  age_group: string;
  dob: string | null;
  msv_status: string;
  status: 'active' | 'inactive';
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

function StudentRowActions({
  id,
  status,
  onChanged,
}: {
  id: string;
  status: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const action = status === 'active' ? 'deactivate' : 'reactivate';
    const reason = status === 'active' ? window.prompt('Reason for deactivation:') : undefined;
    if (status === 'active' && !reason) return;
    setBusy(true);
    try {
      await apiPost(`/v1/admin/students/${id}/status`, {
        action,
        ...(reason ? { reason } : {}),
      });
      toast.success(`Student ${action}d successfully.`);
      onChanged();
    } catch (err) {
      toast.error(
        `Could not ${action} student.`,
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant={status === 'active' ? 'secondary' : 'ghost'}
      disabled={busy}
      onClick={toggle}
    >
      {status === 'active' ? 'Deactivate' : 'Reactivate'}
    </Button>
  );
}

interface CentreOpt { id: string; name: string; }
interface BatchOpt { id: string; name: string; centre_id: string; }

const AGE_GROUPS_S = AGE_GROUPS;

function AddStudentDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [centres, setCentres] = useState<CentreOpt[]>([]);
  const [batches, setBatches] = useState<BatchOpt[]>([]);
  const [fullName, setFullName] = useState('');
  const [centreId, setCentreId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [ageGroup, setAgeGroup] = useState('');
  const [gender, setGender] = useState('');
  const [dob, setDob] = useState('');

  useEffect(() => {
    if (!open) return;
    void apiGet<{ items: CentreOpt[] }>('/v1/admin/centres').then((r) => setCentres(r?.items ?? []));
    void apiGet<{ items: BatchOpt[] }>('/v1/admin/batches').then((r) => setBatches(r?.items ?? []));
  }, [open]);

  const filteredBatches = centreId ? batches.filter((b) => b.centre_id === centreId) : batches;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !centreId || !ageGroup) return;
    setBusy(true);
    try {
      const res = await apiPost<{ student_code: string }>('/v1/admin/students', {
        full_name: fullName.trim(),
        centre_id: centreId,
        batch_id: batchId || undefined,
        age_group: ageGroup,
        gender: gender || undefined,
        dob: dob || undefined,
      });
      toast.success(`Student registered (${res.student_code}).`);
      setOpen(false);
      setFullName(''); setCentreId(''); setBatchId(''); setAgeGroup(''); setGender(''); setDob('');
      onAdded();
    } catch (err) {
      toast.error('Failed to register student.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />Add student</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
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
          <div className="space-y-1">
            <Label className="text-xs font-medium">Age group *</Label>
            <Select value={ageGroup} onValueChange={setAgeGroup}>
              <SelectTrigger><SelectValue placeholder="Select age group" /></SelectTrigger>
              <SelectContent>
                {AGE_GROUPS_S.map((g) => <SelectItem key={g} value={g}>{formatAgeGroup(g)}</SelectItem>)}
              </SelectContent>
            </Select>
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
              <Label className="text-xs font-medium">Date of birth</Label>
              <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !fullName.trim() || !centreId || !ageGroup}>
              {busy ? 'Saving…' : 'Register'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function StudentsPage() {
  const [items, setItems] = useState<AdminStudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: AdminStudentRow[] }>(
        '/v1/admin/students?limit=100',
      );
      setItems(res?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load students.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

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
                      <StudentRowActions id={s.id} status={s.status} onChanged={load} />
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
