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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* ——— Centres ——— */
interface CentreRow {
  id: string;
  name: string;
  locality: string | null;
  city_name: string;
  state_name: string;
  contact_phone: string | null;
  status: string;
  batch_count: number;
}

export function CentresPage() {
  const { items, loading, error } = useAdminList<CentreRow>('/v1/admin/centres');
  return (
    <AdminPageShell title="Centres" subtitle="Manage centres in your scope.">
      {error ? <AdminError message={error} /> : null}
      <AdminTable columns={['Centre', 'Location', 'Phone', 'Batches', 'Status']} loading={loading} empty="" colSpan={5}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={5} message="No centres in scope." /> : null}
        {items.map((c) => (
          <tr key={c.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">{c.name}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">
              {[c.locality, c.city_name, c.state_name].filter(Boolean).join(', ')}
            </td>
            <td className="px-4 py-3 text-xs">{c.contact_phone ?? '—'}</td>
            <td className="px-4 py-3">{c.batch_count}</td>
            <td className="px-4 py-3 text-xs capitalize">{c.status}</td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

/* ——— Notices ——— */
interface NoticeRow {
  id: string;
  title_en: string;
  audience: string;
  is_public: boolean;
  pinned: boolean;
  is_critical: boolean;
  created_at: string;
}

export function NoticesPage() {
  const { items, loading, error } = useAdminList<NoticeRow>('/v1/admin/notices?limit=100');
  return (
    <AdminPageShell title="Notices" subtitle="Published and draft notices in your scope.">
      {error ? <AdminError message={error} /> : null}
      <AdminTable columns={['Title', 'Audience', 'Flags', 'Created']} loading={loading} empty="" colSpan={4}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={4} message="No notices yet." /> : null}
        {items.map((n) => (
          <tr key={n.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">{n.title_en}</td>
            <td className="px-4 py-3 text-xs capitalize">{n.audience}</td>
            <td className="px-4 py-3 flex flex-wrap gap-1">
              {n.pinned ? <Badge variant="secondary">Pinned</Badge> : null}
              {n.is_critical ? <Badge className="bg-red-100 text-red-800">Critical</Badge> : null}
              {n.is_public ? <Badge>Public</Badge> : <Badge variant="outline">Internal</Badge>}
            </td>
            <td className="px-4 py-3 text-xs text-muted-foreground">
              {new Date(n.created_at).toLocaleDateString('en-GB')}
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

/* ——— Gallery ——— */
interface GalleryRow {
  id: string;
  student_name: string;
  niyam_title_en: string;
  is_featured: boolean;
  is_public: boolean;
  created_at: string;
}

function GalleryActions({ id, featured, onChanged }: { id: string; featured: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try {
      await apiPost(`/v1/admin/gallery/${id}/${featured ? 'unfeature' : 'feature'}`, {});
      toast.success(featured ? 'Removed from featured.' : 'Marked as featured.');
      onChanged();
    } catch (err) {
      toast.error('Action failed.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={toggle}>
      {featured ? 'Unfeature' : 'Feature'}
    </Button>
  );
}

export function GalleryPage() {
  const { items, loading, error, reload } = useAdminList<GalleryRow>('/v1/admin/gallery?limit=100');
  return (
    <AdminPageShell title="Gallery" subtitle="Niyam submissions shared to the public gallery.">
      {error ? <AdminError message={error} /> : null}
      <AdminTable columns={['Student', 'Niyam', 'Featured', 'Public', 'Actions']} loading={loading} empty="" colSpan={5}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={5} message="No gallery items." /> : null}
        {items.map((g) => (
          <tr key={g.id} className="hover:bg-muted/30">
            <td className="px-4 py-3">{g.student_name}</td>
            <td className="px-4 py-3 text-xs">{g.niyam_title_en}</td>
            <td className="px-4 py-3">{g.is_featured ? 'Yes' : '—'}</td>
            <td className="px-4 py-3">{g.is_public ? 'Yes' : 'No'}</td>
            <td className="px-4 py-3">
              <GalleryActions id={g.id} featured={g.is_featured} onChanged={reload} />
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

/* ——— Library ——— */
interface LibraryRow {
  id: string;
  content_type: string;
  title_en: string;
  access_tier: string;
  is_published: boolean;
}

export function LibraryPage() {
  const { items, loading, error } = useAdminList<LibraryRow>('/v1/admin/library?limit=100');
  return (
    <AdminPageShell title="Library" subtitle="Learning resources across the network.">
      {error ? <AdminError message={error} /> : null}
      <AdminTable columns={['Title', 'Type', 'Access', 'Published']} loading={loading} empty="" colSpan={4}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={4} message="No library items." /> : null}
        {items.map((l) => (
          <tr key={l.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">{l.title_en}</td>
            <td className="px-4 py-3 text-xs uppercase">{l.content_type}</td>
            <td className="px-4 py-3 text-xs capitalize">{l.access_tier}</td>
            <td className="px-4 py-3">{l.is_published ? 'Yes' : 'Draft'}</td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

/* ——— Shivirs ——— */
interface ShivirRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  city_name: string;
  is_published: boolean;
  capacity: number | null;
}

export function ShivirsPage() {
  const { items, loading, error } = useAdminList<ShivirRow>('/v1/admin/shivirs?limit=100');
  return (
    <AdminPageShell title="Shivirs" subtitle="Residential and day camps.">
      {error ? <AdminError message={error} /> : null}
      <AdminTable columns={['Name', 'Dates', 'City', 'Capacity', 'Published']} loading={loading} empty="" colSpan={5}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={5} message="No shivirs." /> : null}
        {items.map((s) => (
          <tr key={s.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">{s.name}</td>
            <td className="px-4 py-3 text-xs">
              {s.start_date} – {s.end_date}
            </td>
            <td className="px-4 py-3 text-xs">{s.city_name}</td>
            <td className="px-4 py-3">{s.capacity ?? '—'}</td>
            <td className="px-4 py-3">{s.is_published ? 'Yes' : 'Draft'}</td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

/* ——— Niyams ——— */
interface NiyamRow {
  id: string;
  title_en: string;
  niyam_type: string;
  points: number;
  is_active: boolean;
}

export function NiyamsPage() {
  const { items, loading, error } = useAdminList<NiyamRow>('/v1/admin/niyams');
  return (
    <AdminPageShell title="Niyams" subtitle="Spiritual commitments catalogue.">
      {error ? <AdminError message={error} /> : null}
      <AdminTable columns={['Title', 'Type', 'Points', 'Active']} loading={loading} empty="" colSpan={4}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={4} message="No niyams defined." /> : null}
        {items.map((n) => (
          <tr key={n.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">{n.title_en}</td>
            <td className="px-4 py-3 text-xs capitalize">{n.niyam_type}</td>
            <td className="px-4 py-3">{n.points}</td>
            <td className="px-4 py-3">{n.is_active ? 'Yes' : 'No'}</td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

/* ——— Punya ——— */
interface PunyaConfigRow {
  id: string;
  feature_key: string;
  points: number;
  is_active: boolean;
}

export function PunyaConfigsPage() {
  const { items, loading, error } = useAdminList<PunyaConfigRow>('/v1/admin/punya/configs');
  return (
    <AdminPageShell title="Punya configs" subtitle="Point values per feature key.">
      {error ? <AdminError message={error} /> : null}
      <AdminTable columns={['Feature', 'Points', 'Active']} loading={loading} empty="" colSpan={3}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={3} message="No configs." /> : null}
        {items.map((c) => (
          <tr key={c.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-mono text-xs">{c.feature_key}</td>
            <td className="px-4 py-3">{c.points}</td>
            <td className="px-4 py-3">{c.is_active ? 'Yes' : 'No'}</td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

interface PunyaTxnRow {
  id: string;
  student_name: string;
  student_code: string;
  feature_key: string;
  points: number;
  note: string | null;
  awarded_by_name: string | null;
  created_at: string;
}

function PunyaAuditTable({ title, subtitle }: { title: string; subtitle: string }) {
  const { items, loading, error } = useAdminList<PunyaTxnRow>('/v1/admin/punya/transactions?limit=200');
  return (
    <AdminPageShell title={title} subtitle={subtitle}>
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['When', 'Student', 'Feature', 'Points', 'By', 'Note']}
        loading={loading}
        empty=""
        colSpan={6}
      >
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={6} message="No transactions." /> : null}
        {items.map((t) => (
          <tr key={t.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 text-xs whitespace-nowrap">
              {new Date(t.created_at).toLocaleString('en-GB')}
            </td>
            <td className="px-4 py-3">
              <div className="font-medium">{t.student_name}</div>
              <div className="font-mono text-xs text-muted-foreground">{t.student_code}</div>
            </td>
            <td className="px-4 py-3 font-mono text-xs">{t.feature_key}</td>
            <td className="px-4 py-3 font-semibold text-primary">+{t.points}</td>
            <td className="px-4 py-3 text-xs">{t.awarded_by_name ?? '—'}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground max-w-[12rem] truncate">
              {t.note ?? '—'}
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

export function PunyaAuditPage() {
  return (
    <PunyaAuditTable title="Punya audit" subtitle="Recent Punya awards in your scope." />
  );
}

export function PunyaAwardPage() {
  const [studentId, setStudentId] = useState('');
  const [points, setPoints] = useState('10');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId.trim()) return;
    setBusy(true);
    try {
      const res = await apiPost<{ total_points: number; tier: string }>('/v1/admin/punya/award', {
        student_id: studentId.trim(),
        points: Number(points),
        note: note.trim() || undefined,
      });
      toast.success(`Awarded ${points} Punya. New total: ${res.total_points} (${res.tier}).`);
      setNote('');
    } catch (err) {
      toast.error('Award failed.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPageShell title="Award Punya" subtitle="Manually award points to a student in your scope.">
      <Card className="max-w-md p-6">
        <form className="space-y-4" onSubmit={submit}>
          <div>
            <Label htmlFor="student_id">Student ID (UUID)</Label>
            <Input
              id="student_id"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder="From Students list"
              className="mt-1 font-mono text-xs"
            />
          </div>
          <div>
            <Label htmlFor="points">Points</Label>
            <Input
              id="points"
              type="number"
              min={1}
              max={500}
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="note">Note (optional)</Label>
            <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} className="mt-1" />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Awarding…' : 'Award Punya'}
          </Button>
        </form>
      </Card>
    </AdminPageShell>
  );
}

/* ——— People ——— */
interface ShikshakRow {
  id: string;
  full_name: string;
  phone: string;
  batch_count: number;
}

export function ShikshaksPage() {
  const { items, loading, error } = useAdminList<ShikshakRow>('/v1/admin/shikshaks');
  return (
    <AdminPageShell title="Shikshaks" subtitle="Gurujis and Didis teaching batches in your scope.">
      {error ? <AdminError message={error} /> : null}
      <AdminTable columns={['Name', 'Phone', 'Batches']} loading={loading} empty="" colSpan={3}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={3} message="No shikshaks in scope." /> : null}
        {items.map((s) => (
          <tr key={s.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">{s.full_name}</td>
            <td className="px-4 py-3 text-xs">{s.phone}</td>
            <td className="px-4 py-3">{s.batch_count}</td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

interface MsvRow {
  id: string;
  student_name: string;
  student_code: string;
  status: string;
  reason: string | null;
  created_at: string;
}

export function MsvEnrolmentsPage() {
  const { items, loading, error } = useAdminList<MsvRow>('/v1/admin/msv-enrolments?limit=100');
  return (
    <AdminPageShell title="MSV applications" subtitle="Megh Sanskar Vatika programme applications.">
      {error ? <AdminError message={error} /> : null}
      <AdminTable columns={['Student', 'Code', 'Status', 'Reason', 'Applied']} loading={loading} empty="" colSpan={5}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={5} message="No MSV applications." /> : null}
        {items.map((m) => (
          <tr key={m.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">{m.student_name}</td>
            <td className="px-4 py-3 font-mono text-xs">{m.student_code}</td>
            <td className="px-4 py-3 text-xs capitalize">{m.status}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{m.reason ?? '—'}</td>
            <td className="px-4 py-3 text-xs">
              {new Date(m.created_at).toLocaleDateString('en-GB')}
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

/* ——— Holidays & sessions ——— */
interface HolidayRow {
  id: string;
  centre_name: string;
  holiday_date: string;
  reason: string | null;
}

export function HolidaysPage() {
  const { items, loading, error } = useAdminList<HolidayRow>('/v1/admin/holidays?limit=100');
  return (
    <AdminPageShell title="Holiday calendar" subtitle="Scheduled centre holidays.">
      {error ? <AdminError message={error} /> : null}
      <AdminTable columns={['Centre', 'Date', 'Reason']} loading={loading} empty="" colSpan={3}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={3} message="No holidays scheduled." /> : null}
        {items.map((h) => (
          <tr key={h.id} className="hover:bg-muted/30">
            <td className="px-4 py-3">{h.centre_name}</td>
            <td className="px-4 py-3 text-xs">{h.holiday_date}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{h.reason ?? '—'}</td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

interface SessionRow {
  id: string;
  session_date: string;
  status: string;
  topic: string | null;
  batch_name: string;
  centre_name: string;
  present_count: number;
  total_count: number;
}

export function ServiceRequestsPage() {
  const { items, loading, error } = useAdminList<SessionRow>('/v1/admin/sessions?limit=50');
  return (
    <AdminPageShell
      title="Service requests"
      subtitle="Recent batch sessions — use Enrolments for pending approvals."
    >
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['Date', 'Centre', 'Batch', 'Topic', 'Attendance', 'Status']}
        loading={loading}
        empty=""
        colSpan={6}
      >
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={6} message="No sessions." /> : null}
        {items.map((s) => (
          <tr key={s.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 text-xs">{s.session_date}</td>
            <td className="px-4 py-3 text-xs">{s.centre_name}</td>
            <td className="px-4 py-3 text-xs">{s.batch_name}</td>
            <td className="px-4 py-3 text-xs">{s.topic ?? '—'}</td>
            <td className="px-4 py-3 text-xs">
              {s.present_count}/{s.total_count}
            </td>
            <td className="px-4 py-3 text-xs capitalize">{s.status}</td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

export function ReportsPage() {
  const { items, loading, error } = useAdminList<SessionRow>('/v1/admin/sessions?limit=100');
  return (
    <AdminPageShell title="Reports" subtitle="Session attendance summary in your scope.">
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['Date', 'Centre', 'Batch', 'Present', 'Total', 'Status']}
        loading={loading}
        empty=""
        colSpan={6}
      >
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={6} message="No session data." /> : null}
        {items.map((s) => (
          <tr key={s.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 text-xs">{s.session_date}</td>
            <td className="px-4 py-3 text-xs">{s.centre_name}</td>
            <td className="px-4 py-3 text-xs">{s.batch_name}</td>
            <td className="px-4 py-3">{s.present_count}</td>
            <td className="px-4 py-3">{s.total_count}</td>
            <td className="px-4 py-3 text-xs capitalize">{s.status}</td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

export function AuditPage() {
  return (
    <PunyaAuditTable title="Audit log" subtitle="Punya and manual awards recorded in your scope." />
  );
}

/* ——— System ——— */
export function GeographyPage() {
  const [states, setStates] = useState<{ id: string; name: string; code: string }[]>([]);
  const [cities, setCities] = useState<{ id: string; name: string; state_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ states: typeof states; cities: typeof cities }>('/v1/admin/geography')
      .then((r) => {
        setStates(r?.states ?? []);
        setCities(r?.cities ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdminPageShell title="Geography" subtitle="States and cities in the network.">
      {error ? <AdminError message={error} /> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <AdminTable columns={['State', 'Code']} loading={loading} empty="" colSpan={2}>
          {states.length === 0 && !loading ? <AdminEmptyRow colSpan={2} message="No states." /> : null}
          {states.map((s) => (
            <tr key={s.id}>
              <td className="px-4 py-3">{s.name}</td>
              <td className="px-4 py-3 font-mono text-xs">{s.code}</td>
            </tr>
          ))}
        </AdminTable>
        <AdminTable columns={['City', 'State']} loading={loading} empty="" colSpan={2}>
          {cities.length === 0 && !loading ? <AdminEmptyRow colSpan={2} message="No cities." /> : null}
          {cities.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-3">{c.name}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{c.state_name}</td>
            </tr>
          ))}
        </AdminTable>
      </div>
    </AdminPageShell>
  );
}

interface SettingRow {
  key: string;
  value: string | null;
  updated_at: string;
}

export function SettingsPage() {
  const { items, loading, error } = useAdminList<SettingRow>('/v1/admin/settings');
  return (
    <AdminPageShell title="Settings" subtitle="Platform configuration keys.">
      {error ? <AdminError message={error} /> : null}
      <AdminTable columns={['Key', 'Value', 'Updated']} loading={loading} empty="" colSpan={3}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={3} message="No settings." /> : null}
        {items.map((s) => (
          <tr key={s.key} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-mono text-xs">{s.key}</td>
            <td className="px-4 py-3 text-xs max-w-md truncate">{s.value ?? '—'}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">
              {new Date(s.updated_at).toLocaleDateString('en-GB')}
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}
