import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AdminEmptyRow,
  AdminError,
  AdminPageShell,
  AdminTable,
} from '@/components/admin/AdminPageShell';
import { useAdminList } from '@/hooks/useAdminList';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast-jp';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth-context';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface GeoCity { id: string; name: string; state_name?: string; }

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

function formatInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

/* ——— Curriculum ——— */
interface CurriculumRow {
  id: string;
  name: string;
  kind: string;
  academic_year: string | null;
  status: string;
  city_name: string | null;
  section_count: number;
}

const NO_CITY = '__none__';

function AddCurriculumDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cities, setCities] = useState<GeoCity[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('standard');
  const [year, setYear] = useState('');
  const [cityId, setCityId] = useState(NO_CITY);

  useEffect(() => {
    if (!open) return;
    void apiGet<{ cities: GeoCity[] }>('/v1/admin/geography').then((r) => setCities(r?.cities ?? []));
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await apiPost('/v1/admin/curricula', {
        name: name.trim(), kind,
        academic_year: year.trim() || undefined,
        city_id: cityId === NO_CITY ? undefined : cityId,
      });
      toast.success('Curriculum created.');
      setOpen(false); setName(''); setKind('standard'); setYear(''); setCityId(NO_CITY);
      onAdded();
    } catch (err) {
      toast.error('Failed.', err instanceof ApiError ? err.message : undefined);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />New curriculum</Button></DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Create curriculum</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Name *"><Input value={name} onChange={(e) => setName(e.target.value)} required /></FormRow>
          <FormRow label="Kind">
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['standard', 'msv', 'shikshak', 'special'].map((k) => (
                  <SelectItem key={k} value={k} className="capitalize">{k}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Academic year"><Input value={year} onChange={(e) => setYear(e.target.value)} placeholder="e.g. 2025-26" /></FormRow>
          <FormRow label="City (optional)">
            <Select value={cityId} onValueChange={setCityId}>
              <SelectTrigger><SelectValue placeholder="All cities" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CITY}>All cities</SelectItem>
                {cities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.state_name ? ` (${c.state_name})` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Create'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CurriculumPage() {
  const { items, loading, error, reload } = useAdminList<CurriculumRow>('/v1/admin/curricula');
  const [treeId, setTreeId] = useState<string | null>(null);
  const [tree, setTree] = useState<{
    curriculum: { name: string; kind: string };
    sections: Array<{ title_en: string; items: Array<{ title_en: string }> }>;
  } | null>(null);

  async function loadTree(id: string) {
    setTreeId(id);
    try {
      const data = await apiGet<typeof tree>(`/v1/admin/curricula/${id}/tree`);
      setTree(data);
    } catch {
      setTree(null);
      toast.error('Could not load curriculum tree.');
    }
  }

  return (
    <AdminPageShell title="Curriculum" subtitle="Lesson plans and study materials by city." actions={<AddCurriculumDialog onAdded={reload} />}>
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['Name', 'Kind', 'Year', 'City', 'Sections', '']}
        loading={loading}
        empty=""
        colSpan={6}
      >
        {items.length === 0 && !loading ? (
          <AdminEmptyRow colSpan={6} message="No curricula in scope." />
        ) : null}
        {items.map((c) => (
          <tr key={c.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">{c.name}</td>
            <td className="px-4 py-3 text-xs uppercase">{c.kind}</td>
            <td className="px-4 py-3 text-xs">{c.academic_year ?? '—'}</td>
            <td className="px-4 py-3 text-xs">{c.city_name ?? '—'}</td>
            <td className="px-4 py-3">{c.section_count}</td>
            <td className="px-4 py-3">
              <Button size="sm" variant="outline" onClick={() => loadTree(c.id)}>
                View
              </Button>
            </td>
          </tr>
        ))}
      </AdminTable>
      {tree && treeId ? (
        <Card className="p-6 space-y-4">
          <h3 className="font-display text-lg text-secondary">
            {tree.curriculum.name}{' '}
            <Badge variant="secondary" className="ml-2 uppercase">
              {tree.curriculum.kind}
            </Badge>
          </h3>
          {tree.sections.map((s) => (
            <div key={s.title_en}>
              <h4 className="text-sm font-semibold">{s.title_en}</h4>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                {s.items.map((i) => (
                  <li key={i.title_en}>{i.title_en}</li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      ) : null}
    </AdminPageShell>
  );
}

/* ——— Exams ——— */
interface ExamRow {
  id: string;
  title_en: string;
  city_name: string;
  window_start: string;
  window_end: string;
  exam_otp: string | null;
  results_released: boolean;
  attempt_count: number;
}

function AddExamDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cities, setCities] = useState<GeoCity[]>([]);
  const [title, setTitle] = useState('');
  const [cityId, setCityId] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [totalMarks, setTotalMarks] = useState('100');
  const [passMark, setPassMark] = useState('40');
  const [otp, setOtp] = useState('');

  useEffect(() => {
    if (!open) return;
    void apiGet<{ cities: GeoCity[] }>('/v1/admin/geography').then((r) => setCities(r?.cities ?? []));
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !cityId || !windowStart || !windowEnd) return;
    setBusy(true);
    try {
      const res = await apiPost<{ exam_otp: string }>('/v1/admin/exams', {
        title_en: title.trim(), city_id: cityId,
        window_start: new Date(windowStart).toISOString(),
        window_end: new Date(windowEnd).toISOString(),
        total_marks: Number(totalMarks), pass_mark: Number(passMark),
        exam_otp: otp.trim() || undefined,
      });
      toast.success(`Exam created. OTP: ${res.exam_otp}`);
      setOpen(false); setTitle(''); setCityId(''); setWindowStart(''); setWindowEnd(''); setOtp('');
      onAdded();
    } catch (err) {
      toast.error('Failed.', err instanceof ApiError ? err.message : undefined);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />New exam</Button></DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Create exam</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Title *"><Input value={title} onChange={(e) => setTitle(e.target.value)} required /></FormRow>
          <FormRow label="City *">
            <Select value={cityId} onValueChange={setCityId}>
              <SelectTrigger><SelectValue placeholder="Select city" /></SelectTrigger>
              <SelectContent>
                {cities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.state_name ? ` (${c.state_name})` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Window start *"><Input type="datetime-local" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} required /></FormRow>
            <FormRow label="Window end *"><Input type="datetime-local" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} required /></FormRow>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Total marks"><Input type="number" value={totalMarks} onChange={(e) => setTotalMarks(e.target.value)} /></FormRow>
            <FormRow label="Pass mark"><Input type="number" value={passMark} onChange={(e) => setPassMark(e.target.value)} /></FormRow>
          </div>
          <FormRow label="OTP (auto-generated if blank)"><Input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="e.g. ABC123" className="font-mono" /></FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !title.trim() || !cityId || !windowStart || !windowEnd}>{busy ? 'Saving…' : 'Create'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ExamsPage() {
  const { items, loading, error, reload } = useAdminList<ExamRow>('/v1/admin/exams?limit=50');
  const [busy, setBusy] = useState<string | null>(null);

  async function releaseResults(id: string) {
    setBusy(id);
    try {
      await apiPost(`/v1/admin/exams/${id}/release-results`, {});
      toast.success('Results released.');
      reload();
    } catch (err) {
      toast.error('Failed.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminPageShell title="Exams" subtitle="Online exams, OTP codes, and result release." actions={<AddExamDialog onAdded={reload} />}>
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['Exam', 'City', 'Window', 'OTP', 'Attempts', 'Results', 'Actions']}
        loading={loading}
        empty=""
        colSpan={7}
      >
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={7} message="No exams." /> : null}
        {items.map((e) => (
          <tr key={e.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">{e.title_en}</td>
            <td className="px-4 py-3 text-xs">{e.city_name}</td>
            <td className="px-4 py-3 text-xs whitespace-nowrap">
              {new Date(e.window_start).toLocaleDateString('en-GB')} –{' '}
              {new Date(e.window_end).toLocaleDateString('en-GB')}
            </td>
            <td className="px-4 py-3 font-mono text-xs">{e.exam_otp ?? '—'}</td>
            <td className="px-4 py-3">{e.attempt_count}</td>
            <td className="px-4 py-3">{e.results_released ? 'Released' : 'Pending'}</td>
            <td className="px-4 py-3">
              {!e.results_released ? (
                <Button size="sm" disabled={busy === e.id} onClick={() => releaseResults(e.id)}>
                  Release
                </Button>
              ) : (
                '—'
              )}
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

/* ——— Donations ——— */
interface CampaignRow {
  id: string;
  name: string;
  city_name: string | null;
  target_amount_paise: number | null;
  raised_amount_paise: number;
  is_public: boolean;
}

interface DonationRow {
  id: string;
  donor_name: string;
  amount_paise: number;
  purpose: string;
  status: string;
  eighty_g_eligible: boolean;
  campaign_name: string | null;
  payment_captured_at: string | null;
}

export function DonationsPage() {
  const { items: campaigns, loading: cLoad, error: cErr } =
    useAdminList<CampaignRow>('/v1/admin/donations/campaigns');
  const { items: donations, loading: dLoad, error: dErr } =
    useAdminList<DonationRow>('/v1/admin/donations?limit=100');

  return (
    <AdminPageShell title="Donations" subtitle="Campaigns and captured donations.">
      {cErr ? <AdminError message={cErr} /> : null}
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Campaigns
      </h3>
      <AdminTable columns={['Name', 'City', 'Raised', 'Target', 'Public']} loading={cLoad} empty="" colSpan={5}>
        {campaigns.length === 0 && !cLoad ? <AdminEmptyRow colSpan={5} message="No campaigns." /> : null}
        {campaigns.map((c) => (
          <tr key={c.id}>
            <td className="px-4 py-3 font-medium">{c.name}</td>
            <td className="px-4 py-3 text-xs">{c.city_name ?? '—'}</td>
            <td className="px-4 py-3 font-mono">{formatInr(c.raised_amount_paise)}</td>
            <td className="px-4 py-3 font-mono">{c.target_amount_paise ? formatInr(c.target_amount_paise) : '—'}</td>
            <td className="px-4 py-3">{c.is_public ? 'Yes' : 'No'}</td>
          </tr>
        ))}
      </AdminTable>

      {dErr ? <AdminError message={dErr} /> : null}
      <h3 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Donations
      </h3>
      <AdminTable
        columns={['Donor', 'Amount', 'Purpose', 'Campaign', '80G', 'Status', 'Date']}
        loading={dLoad}
        empty=""
        colSpan={7}
      >
        {donations.length === 0 && !dLoad ? <AdminEmptyRow colSpan={7} message="No donations." /> : null}
        {donations.map((d) => (
          <tr key={d.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">{d.donor_name}</td>
            <td className="px-4 py-3 font-mono font-semibold">{formatInr(d.amount_paise)}</td>
            <td className="px-4 py-3 text-xs capitalize">{d.purpose}</td>
            <td className="px-4 py-3 text-xs">{d.campaign_name ?? '—'}</td>
            <td className="px-4 py-3">{d.eighty_g_eligible ? 'Yes' : '—'}</td>
            <td className="px-4 py-3 text-xs capitalize">{d.status}</td>
            <td className="px-4 py-3 text-xs">
              {d.payment_captured_at
                ? new Date(d.payment_captured_at).toLocaleDateString('en-GB')
                : '—'}
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

/* ——— Queues ——— */
interface QueueStatRow {
  queue_name: string;
  waiting: number;
  active: number;
  completed_24h: number;
  failed: number;
  updated_at: string;
}

interface DlqRow {
  id: string;
  job_id: string;
  queue_name: string;
  error_message: string | null;
  failed_at: string;
}

export function QueuesPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<QueueStatRow[]>([]);
  const [dlq, setDlq] = useState<DlqRow[]>([]);
  const [selectedQueue, setSelectedQueue] = useState('notifications.fanout');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const s = await apiGet<{ items: QueueStatRow[] }>('/v1/admin/queues/stats');
      setStats(s?.items ?? []);
      const d = await apiGet<{ items: DlqRow[] }>(
        `/v1/admin/queues/${encodeURIComponent(selectedQueue)}/dlq`,
      );
      setDlq(d?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load queues.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user?.role === 'super_admin') void load();
  }, [user?.role, selectedQueue]);

  async function replay(jobId: string) {
    try {
      await apiPost(
        `/v1/admin/queues/${encodeURIComponent(selectedQueue)}/dlq/${encodeURIComponent(jobId)}/replay`,
        {},
      );
      toast.success('Job replayed.');
      void load();
    } catch (err) {
      toast.error('Replay failed.', err instanceof ApiError ? err.message : undefined);
    }
  }

  if (user?.role !== 'super_admin') {
    return (
      <AdminPageShell title="Queues" subtitle="Background job queue status">
        <Card className="p-6 text-sm text-muted-foreground">
          Queue monitoring is restricted to super administrators.
        </Card>
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell title="Queues" subtitle="Background job depth and dead-letter queue (super admin).">
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['Queue', 'Waiting', 'Active', 'Completed (24h)', 'Failed', 'Updated']}
        loading={loading}
        empty=""
        colSpan={6}
      >
        {stats.length === 0 && !loading ? <AdminEmptyRow colSpan={6} message="No queue stats." /> : null}
        {stats.map((q) => (
          <tr
            key={q.queue_name}
            className={`hover:bg-muted/30 cursor-pointer ${selectedQueue === q.queue_name ? 'bg-muted/50' : ''}`}
            onClick={() => setSelectedQueue(q.queue_name)}
          >
            <td className="px-4 py-3 font-mono text-xs">{q.queue_name}</td>
            <td className="px-4 py-3">{q.waiting}</td>
            <td className="px-4 py-3">{q.active}</td>
            <td className="px-4 py-3">{q.completed_24h}</td>
            <td className="px-4 py-3 text-destructive font-semibold">{q.failed}</td>
            <td className="px-4 py-3 text-xs">
              {new Date(q.updated_at).toLocaleString('en-GB')}
            </td>
          </tr>
        ))}
      </AdminTable>

      <h3 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        DLQ: {selectedQueue}
      </h3>
      <AdminTable columns={['Job ID', 'Error', 'Failed', 'Actions']} loading={loading} empty="" colSpan={4}>
        {dlq.length === 0 && !loading ? (
          <AdminEmptyRow colSpan={4} message="No failed jobs in DLQ." />
        ) : null}
        {dlq.map((j) => (
          <tr key={j.id}>
            <td className="px-4 py-3 font-mono text-xs">{j.job_id}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground max-w-md truncate">
              {j.error_message ?? '—'}
            </td>
            <td className="px-4 py-3 text-xs whitespace-nowrap">
              {new Date(j.failed_at).toLocaleString('en-GB')}
            </td>
            <td className="px-4 py-3">
              <Button size="sm" variant="outline" onClick={() => replay(j.job_id)}>
                Replay
              </Button>
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}
