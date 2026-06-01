import { useEffect, useState } from 'react';
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
import { useAuth } from '@/lib/auth-context';

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

export function CurriculumPage() {
  const { items, loading, error } = useAdminList<CurriculumRow>('/v1/admin/curricula');
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
    <AdminPageShell title="Curriculum" subtitle="Lesson plans and study materials by city.">
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
    <AdminPageShell title="Exams" subtitle="Online exams, OTP codes, and result release.">
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
            <td className="px-4 py-3">{formatInr(c.raised_amount_paise)}</td>
            <td className="px-4 py-3">{c.target_amount_paise ? formatInr(c.target_amount_paise) : '—'}</td>
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
            <td className="px-4 py-3 font-semibold">{formatInr(d.amount_paise)}</td>
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
