import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AdminEmptyRow,
  AdminError,
  AdminLoadMore,
  AdminPageShell,
  AdminTable,
} from '@/components/admin/AdminPageShell';
import { useAdminList } from '@/hooks/useAdminList';
import { useAuth } from '@/lib/auth-context';
import { apiGet, apiPost, apiPatch, ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast-jp';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

/* ─── shared form helper ─── */
function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

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

interface GeoOption { id: string; name: string; state_id?: string; state_name?: string; }

function AddCentreDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cities, setCities] = useState<GeoOption[]>([]);
  const [name, setName] = useState('');
  const [cityId, setCityId] = useState('');
  const [locality, setLocality] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    if (!open) return;
    void apiGet<{ cities: GeoOption[] }>('/v1/admin/geography').then((r) => {
      setCities(r?.cities ?? []);
    });
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !cityId) return;
    setBusy(true);
    const cityOpt = cities.find((c) => c.id === cityId);
    try {
      await apiPost('/v1/admin/centres', {
        name: name.trim(),
        city_id: cityId,
        state_id: cityOpt?.state_id ?? '',
        locality: locality.trim() || undefined,
        contact_phone: phone.trim() || undefined,
      });
      toast.success('Centre created.');
      setOpen(false);
      setName(''); setCityId(''); setLocality(''); setPhone('');
      onAdded();
    } catch (err) {
      toast.error('Failed to create centre.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />Add centre</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add centre</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Centre name *">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Andheri Pathshala" required />
          </FormRow>
          <FormRow label="City *">
            <Select value={cityId} onValueChange={setCityId}>
              <SelectTrigger><SelectValue placeholder="Select city" /></SelectTrigger>
              <SelectContent>
                {cities.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}{c.state_name ? ` (${c.state_name})` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Locality / area">
            <Input value={locality} onChange={(e) => setLocality(e.target.value)} placeholder="e.g. Andheri West" />
          </FormRow>
          <FormRow label="Contact phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" />
          </FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !name.trim() || !cityId}>
              {busy ? 'Saving…' : 'Create centre'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CentresPage() {
  const { user } = useAuth();
  const canCreateCentre =
    user?.role === 'super_admin' ||
    user?.role === 'state_admin' ||
    user?.role === 'city_admin';
  const { items, loading, error, reload } = useAdminList<CentreRow>('/v1/admin/centres');
  return (
    <AdminPageShell
      title="Centres"
      subtitle="Manage centres in your scope. Open a centre to add sanchalaks and Guruji / Didi."
      actions={canCreateCentre ? <AddCentreDialog onAdded={reload} /> : undefined}
    >
      {error ? <AdminError message={error} /> : null}
      <AdminTable columns={['Centre', 'Location', 'Phone', 'Batches', 'Status']} loading={loading} empty="" colSpan={5}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={5} message="No centres in scope." /> : null}
        {items.map((c) => (
          <tr key={c.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">
              <a href={`/admin/centres/${c.id}`} className="text-primary underline-offset-2 hover:underline">
                {c.name}
              </a>
            </td>
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

const NOTICE_AUDIENCES = ['national', 'state', 'city', 'centre', 'batch', 'msv'] as const;

function AddNoticeDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [titleHi, setTitleHi] = useState('');
  const [content, setContent] = useState('');
  const [audience, setAudience] = useState<string>('national');
  const [isPublic, setIsPublic] = useState(true);
  const [pinned, setPinned] = useState(false);
  const [critical, setCritical] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await apiPost('/v1/admin/notices', {
        title_en: title.trim(),
        title_hi: titleHi.trim() || undefined,
        content_en: content.trim() || undefined,
        audience,
        is_public: isPublic,
        pinned,
        is_critical: critical,
        publish_now: true,
      });
      toast.success('Notice published.');
      setOpen(false);
      setTitle(''); setTitleHi(''); setContent('');
      onAdded();
    } catch (err) {
      toast.error('Failed to create notice.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />New notice</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Create notice</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Title (English) *">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </FormRow>
          <FormRow label="Title (Hindi)">
            <Input value={titleHi} onChange={(e) => setTitleHi(e.target.value)} />
          </FormRow>
          <FormRow label="Content">
            <Textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} />
          </FormRow>
          <FormRow label="Audience">
            <Select value={audience} onValueChange={setAudience}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {NOTICE_AUDIENCES.map((a) => (
                  <SelectItem key={a} value={a} className="capitalize">{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="rounded" />
              Public
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="rounded" />
              Pinned
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} className="rounded" />
              Critical
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !title.trim()}>{busy ? 'Publishing…' : 'Publish'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NoticesPage() {
  const { items, loading, error, reload } = useAdminList<NoticeRow>('/v1/admin/notices?limit=100');
  return (
    <AdminPageShell title="Notices" subtitle="Published and draft notices in your scope." actions={<AddNoticeDialog onAdded={reload} />}>
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
      const res = await fetch(
        `${(import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''}/v1/gallery/admin/${id}/featured`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ featured_gallery: !featured }),
        },
      );
      if (!res.ok) throw new Error('feature');
      toast.success(featured ? 'Removed from Punya Wall.' : 'Featured on Punya Wall.');
      onChanged();
    } catch (err) {
      toast.error('Action failed.', err instanceof Error ? err.message : undefined);
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

function AddLibraryDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [titleEn, setTitleEn] = useState('');
  const [titleHi, setTitleHi] = useState('');
  const [contentType, setContentType] = useState('pdf');
  const [accessTier, setAccessTier] = useState('public');
  const [embedUrl, setEmbedUrl] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [descEn, setDescEn] = useState('');
  const [isPublished, setIsPublished] = useState(true);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!titleEn.trim()) return;
    setBusy(true);
    try {
      await apiPost('/v1/admin/library', {
        title_en: titleEn.trim(),
        title_hi: titleHi.trim() || undefined,
        content_type: contentType,
        access_tier: accessTier,
        embed_url: embedUrl.trim() || undefined,
        file_url: fileUrl.trim() || undefined,
        description_en: descEn.trim() || undefined,
        is_published: isPublished,
      });
      toast.success('Library item created.');
      setOpen(false);
      setTitleEn(''); setTitleHi(''); setEmbedUrl(''); setFileUrl(''); setDescEn('');
      onAdded();
    } catch (err) {
      toast.error('Failed.', err instanceof ApiError ? err.message : undefined);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />Add item</Button></DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add library item</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Title (English) *"><Input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} required /></FormRow>
          <FormRow label="Title (Hindi)"><Input value={titleHi} onChange={(e) => setTitleHi(e.target.value)} /></FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Content type">
              <Select value={contentType} onValueChange={setContentType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['pdf', 'video', 'audio', 'image'].map((t) => <SelectItem key={t} value={t} className="uppercase">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormRow>
            <FormRow label="Access tier">
              <Select value={accessTier} onValueChange={setAccessTier}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['public', 'student', 'msv', 'shikshak'].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormRow>
          </div>
          <FormRow label="Embed URL"><Input value={embedUrl} onChange={(e) => setEmbedUrl(e.target.value)} placeholder="https://…" /></FormRow>
          <FormRow label="File URL"><Input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://…" /></FormRow>
          <FormRow label="Description"><Textarea rows={2} value={descEn} onChange={(e) => setDescEn(e.target.value)} /></FormRow>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} className="rounded" />
            Published
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !titleEn.trim()}>{busy ? 'Saving…' : 'Add item'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LibraryPage() {
  const { items, loading, error, reload } = useAdminList<LibraryRow>('/v1/admin/library?limit=100');
  return (
    <AdminPageShell title="Library" subtitle="Learning resources across the network." actions={<AddLibraryDialog onAdded={reload} />}>
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

function AddShivirDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cities, setCities] = useState<GeoOption[]>([]);
  const [name, setName] = useState('');
  const [cityId, setCityId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [location, setLocation] = useState('');
  const [capacity, setCapacity] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) return;
    void apiGet<{ cities: GeoOption[] }>('/v1/admin/geography').then((r) => setCities(r?.cities ?? []));
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !cityId || !startDate || !endDate) return;
    setBusy(true);
    try {
      await apiPost('/v1/admin/shivirs', {
        name: name.trim(),
        city_id: cityId,
        start_date: startDate,
        end_date: endDate,
        location_text: location.trim() || undefined,
        capacity: capacity ? Number(capacity) : undefined,
        description: description.trim() || undefined,
        is_published: true,
      });
      toast.success('Shivir created.');
      setOpen(false);
      setName(''); setCityId(''); setStartDate(''); setEndDate(''); setLocation(''); setCapacity(''); setDescription('');
      onAdded();
    } catch (err) {
      toast.error('Failed to create shivir.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />New shivir</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Create shivir</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Name *">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </FormRow>
          <FormRow label="City *">
            <Select value={cityId} onValueChange={setCityId}>
              <SelectTrigger><SelectValue placeholder="Select city" /></SelectTrigger>
              <SelectContent>
                {cities.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}{c.state_name ? ` (${c.state_name})` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Start date *">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </FormRow>
            <FormRow label="End date *">
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
            </FormRow>
          </div>
          <FormRow label="Location / venue">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Venue address" />
          </FormRow>
          <FormRow label="Capacity">
            <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="e.g. 100" />
          </FormRow>
          <FormRow label="Description">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !name.trim() || !cityId || !startDate || !endDate}>
              {busy ? 'Saving…' : 'Create shivir'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ShivirsPage() {
  const { items, loading, error, reload } = useAdminList<ShivirRow>('/v1/admin/shivirs?limit=100');
  return (
    <AdminPageShell title="Shivirs" subtitle="Residential and day camps." actions={<AddShivirDialog onAdded={reload} />}>
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
  description_en: string | null;
  niyam_type: string;
  proof_type: string;
  proof_required: boolean;
  approval_mode: string;
  max_uploads: number;
  points: number;
  is_active: boolean;
  scope: string;
  state_id: string | null;
  city_id: string | null;
  state_name: string | null;
  city_name: string | null;
  msv_audience: string;
}

interface GeoStateOpt { id: string; name: string; }
interface GeoCityOpt { id: string; name: string; state_id: string; state_name?: string; }

function AddNiyamDialog({ onAdded }: { onAdded: () => void }) {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const defaultScope =
    role === 'city_admin' ? 'city' : role === 'state_admin' ? 'state' : 'national';

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [titleEn, setTitleEn] = useState('');
  const [titleHi, setTitleHi] = useState('');
  const [descEn, setDescEn] = useState('');
  const [niyamType, setNiyamType] = useState('daily');
  const [proofType, setProofType] = useState('either');
  const [proofRequired, setProofRequired] = useState(false);
  const [approvalMode, setApprovalMode] = useState('auto');
  const [maxUploads, setMaxUploads] = useState('3');
  const [points, setPoints] = useState('10');
  const [isActive, setIsActive] = useState(true);
  const [scope, setScope] = useState(defaultScope);
  const [msvAudience, setMsvAudience] = useState('all');
  const [stateId, setStateId] = useState(user?.state_id ?? '');
  const [cityId, setCityId] = useState(user?.city_id ?? '');
  const [states, setStates] = useState<GeoStateOpt[]>([]);
  const [cities, setCities] = useState<GeoCityOpt[]>([]);

  const scopeOptions =
    role === 'city_admin'
      ? (['city'] as const)
      : role === 'state_admin'
        ? (['state', 'city'] as const)
        : (['national', 'state', 'city'] as const);

  useEffect(() => {
    if (!open) return;
    void apiGet<{ states: GeoStateOpt[]; cities: GeoCityOpt[] }>('/v1/admin/geography').then((r) => {
      setStates(r?.states ?? []);
      let cityList = r?.cities ?? [];
      if (role === 'state_admin' && user?.state_id) {
        cityList = cityList.filter((c) => c.state_id === user.state_id);
      }
      if (role === 'city_admin' && user?.city_id) {
        cityList = cityList.filter((c) => c.id === user.city_id);
      }
      setCities(cityList);
      if (user?.state_id) setStateId(user.state_id);
      if (user?.city_id) setCityId(user.city_id);
    });
  }, [open, role, user?.state_id, user?.city_id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!titleEn.trim()) return;
    if (scope === 'state' && !stateId && role === 'super_admin') {
      toast.error('Select a state.');
      return;
    }
    if (scope === 'city' && !cityId && role !== 'city_admin') {
      toast.error('Select a city.');
      return;
    }
    setBusy(true);
    try {
      await apiPost('/v1/admin/niyams', {
        title_en: titleEn.trim(),
        title_hi: titleHi.trim() || undefined,
        description_en: descEn.trim() || undefined,
        niyam_type: niyamType,
        proof_type: proofType,
        proof_required: proofRequired,
        approval_mode: approvalMode,
        max_uploads: Number(maxUploads),
        points: Number(points),
        is_active: isActive,
        scope,
        msv_audience: msvAudience,
        ...(scope === 'state' && stateId ? { state_id: stateId } : {}),
        ...(scope === 'city' && cityId ? { city_id: cityId } : {}),
      });
      toast.success('Niyam created.');
      setOpen(false);
      setTitleEn(''); setTitleHi(''); setDescEn('');
      setProofType('either'); setProofRequired(false); setApprovalMode('auto'); setMaxUploads('3');
      setScope(defaultScope);
      setMsvAudience('all');
      onAdded();
    } catch (err) {
      toast.error('Failed.', err instanceof ApiError ? err.message : undefined);
    } finally { setBusy(false); }
  }

  const citiesForState = scope === 'city' && stateId
    ? cities.filter((c) => c.state_id === stateId)
    : cities;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />New niyam</Button></DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create niyam</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Title (English) *"><Input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} required /></FormRow>
          <FormRow label="Title (Hindi)"><Input value={titleHi} onChange={(e) => setTitleHi(e.target.value)} /></FormRow>
          <FormRow label="Description"><Textarea rows={2} value={descEn} onChange={(e) => setDescEn(e.target.value)} /></FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Type">
              <Select value={niyamType} onValueChange={setNiyamType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['daily', 'weekly', 'monthly'].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormRow>
            <FormRow label="Proof type">
              <Select value={proofType} onValueChange={(v) => {
                setProofType(v);
                if (v === 'photo' || v === 'video' || v === 'audio') setProofRequired(true);
                if (v === 'either' || v === 'any') setProofRequired(false);
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="either">Photo or video</SelectItem>
                  <SelectItem value="photo">Photo only</SelectItem>
                  <SelectItem value="video">Video only</SelectItem>
                  <SelectItem value="audio">Audio only</SelectItem>
                  <SelectItem value="any">Any media</SelectItem>
                </SelectContent>
              </Select>
            </FormRow>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Approval">
              <Select value={approvalMode} onValueChange={setApprovalMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-approve</SelectItem>
                  <SelectItem value="review">Review queue</SelectItem>
                </SelectContent>
              </Select>
            </FormRow>
            <FormRow label="Max uploads">
              <Input type="number" min={0} max={10} value={maxUploads} onChange={(e) => setMaxUploads(e.target.value)} />
            </FormRow>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={proofRequired} onChange={(e) => setProofRequired(e.target.checked)} className="rounded" />
            Proof required
          </label>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Geography">
              <Select value={scope} onValueChange={(v) => { setScope(v); if (v === 'national') { setStateId(''); setCityId(''); } }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {scopeOptions.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormRow>
            <FormRow label="MSV audience">
              <Select value={msvAudience} onValueChange={setMsvAudience}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All students</SelectItem>
                  <SelectItem value="msv">MSV only</SelectItem>
                  <SelectItem value="non_msv">Non-MSV only</SelectItem>
                </SelectContent>
              </Select>
            </FormRow>
          </div>
          {scope === 'state' && role === 'super_admin' ? (
            <FormRow label="State *">
              <Select value={stateId} onValueChange={setStateId}>
                <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent>
                  {states.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormRow>
          ) : null}
          {scope === 'city' && role !== 'city_admin' ? (
            <>
              {role === 'super_admin' ? (
                <FormRow label="State">
                  <Select value={stateId} onValueChange={(v) => { setStateId(v); setCityId(''); }}>
                    <SelectTrigger><SelectValue placeholder="Filter by state" /></SelectTrigger>
                    <SelectContent>
                      {states.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormRow>
              ) : null}
              <FormRow label="City *">
                <Select value={cityId} onValueChange={setCityId}>
                  <SelectTrigger><SelectValue placeholder="Select city" /></SelectTrigger>
                  <SelectContent>
                    {(role === 'super_admin' ? citiesForState : cities).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormRow>
            </>
          ) : null}
          <FormRow label="Points"><Input type="number" min={0} value={points} onChange={(e) => setPoints(e.target.value)} /></FormRow>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded" />
            Active
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !titleEn.trim()}>{busy ? 'Saving…' : 'Create'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function canToggleNiyam(role: string | undefined, n: NiyamRow, userStateId?: string | null, userCityId?: string | null): boolean {
  if (role === 'super_admin') return true;
  if (role === 'state_admin') {
    if (n.scope === 'national') return false;
    return n.state_id === userStateId;
  }
  if (role === 'city_admin') {
    return n.scope === 'city' && n.city_id === userCityId;
  }
  return false;
}

export function NiyamsPage() {
  const { user } = useAuth();
  const { items, loading, error, reload } = useAdminList<NiyamRow>('/v1/admin/niyams');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function toggleActive(n: NiyamRow, next: boolean) {
    setTogglingId(n.id);
    try {
      await apiPatch(`/v1/admin/niyams/${n.id}`, { is_active: next });
      toast.success(next ? 'Niyam enabled.' : 'Niyam disabled.');
      reload();
    } catch (err) {
      toast.error('Could not update niyam.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setTogglingId(null);
    }
  }

  const audienceLabel = (a: string) =>
    a === 'msv' ? 'MSV' : a === 'non_msv' ? 'Non-MSV' : 'All';

  const scopeLabel = (n: NiyamRow) => {
    if (n.scope === 'national') return 'National';
    if (n.scope === 'state') return n.state_name ? `State · ${n.state_name}` : 'State';
    return n.city_name ? `City · ${n.city_name}` : 'City';
  };

  return (
    <AdminPageShell title="Niyams" subtitle="Spiritual commitments catalogue." actions={<AddNiyamDialog onAdded={reload} />}>
      {error ? <AdminError message={error} /> : null}
      <AdminTable columns={['Title', 'Type', 'Proof', 'Approval', 'Uploads', 'Scope', 'Audience', 'Points', 'Active']} loading={loading} empty="" colSpan={9}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={9} message="No niyams defined." /> : null}
        {items.map((n) => {
          const canToggle = canToggleNiyam(user?.role, n, user?.state_id, user?.city_id);
          return (
            <tr key={n.id} className="hover:bg-muted/30">
              <td className="px-4 py-3">
                <div className="font-medium">{n.title_en}</div>
                {n.description_en ? (
                  <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{n.description_en}</div>
                ) : null}
              </td>
              <td className="px-4 py-3 text-xs capitalize">{n.niyam_type}</td>
              <td className="px-4 py-3 text-xs">
                <span className="capitalize">{n.proof_type}</span>
                {n.proof_required ? <span className="text-muted-foreground"> · req</span> : null}
              </td>
              <td className="px-4 py-3 text-xs capitalize">{n.approval_mode ?? 'auto'}</td>
              <td className="px-4 py-3 text-xs">{n.max_uploads ?? 3}</td>
              <td className="px-4 py-3 text-xs">{scopeLabel(n)}</td>
              <td className="px-4 py-3 text-xs">{audienceLabel(n.msv_audience)}</td>
              <td className="px-4 py-3">{n.points}</td>
              <td className="px-4 py-3">
                {canToggle ? (
                  <Switch
                    checked={n.is_active}
                    disabled={togglingId === n.id}
                    onCheckedChange={(v) => void toggleActive(n, v)}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">{n.is_active ? 'Yes' : 'No'}</span>
                )}
              </td>
            </tr>
          );
        })}
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

function AddPunyaConfigDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [featureKey, setFeatureKey] = useState('');
  const [points, setPoints] = useState('10');
  const [isActive, setIsActive] = useState(true);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!featureKey.trim()) return;
    setBusy(true);
    try {
      await apiPost('/v1/admin/punya/configs', {
        feature_key: featureKey.trim(),
        points: Number(points),
        is_active: isActive,
      });
      toast.success('Punya config created.');
      setOpen(false);
      setFeatureKey(''); setPoints('10'); setIsActive(true);
      onAdded();
    } catch (err) {
      toast.error('Failed.', err instanceof ApiError ? err.message : undefined);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />New config</Button></DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Add Punya config</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Feature key *">
            <Input value={featureKey} onChange={(e) => setFeatureKey(e.target.value)} placeholder="e.g. attendance_full_week" className="font-mono text-xs" required />
          </FormRow>
          <FormRow label="Points"><Input type="number" min={0} value={points} onChange={(e) => setPoints(e.target.value)} /></FormRow>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded" />
            Active
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !featureKey.trim()}>{busy ? 'Saving…' : 'Create'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PunyaConfigsPage() {
  const { items, loading, error, reload } = useAdminList<PunyaConfigRow>('/v1/admin/punya/configs');
  return (
    <AdminPageShell title="Punya configs" subtitle="Point values per feature key." actions={<AddPunyaConfigDialog onAdded={reload} />}>
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
  const { items, loading, loadingMore, error, hasMore, loadMore } = useAdminList<PunyaTxnRow>(
    '/v1/admin/punya/transactions?limit=200',
  );
  return (
    <AdminPageShell title={title} subtitle={subtitle}>
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['When', 'Student', 'Feature', 'Points', 'By', 'Note']}
        loading={loading}
        empty=""
        colSpan={6}
        footer={
          <AdminLoadMore hasMore={hasMore} loadingMore={loadingMore} onLoadMore={() => void loadMore()} />
        }
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

interface AwardStudentOption { id: string; full_name: string | null; student_code: string; }

export function PunyaAwardPage() {
  const [students, setStudents] = useState<AwardStudentOption[]>([]);
  const [studentId, setStudentId] = useState('');
  const [points, setPoints] = useState('10');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void apiGet<{ items: AwardStudentOption[] }>('/v1/admin/students?limit=500').then((r) => setStudents(r?.items ?? []));
  }, []);

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
            <Label htmlFor="student_id">Student</Label>
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger id="student_id" className="mt-1">
                <SelectValue placeholder="Select a student" />
              </SelectTrigger>
              <SelectContent>
                {students.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {(s.full_name ?? 'Unnamed')} — {s.student_code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

function AddHolidayDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [centres, setCentres] = useState<GeoOption[]>([]);
  const [centreId, setCentreId] = useState('');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    void apiGet<{ items: GeoOption[] }>('/v1/admin/centres').then((r) => setCentres(r?.items ?? []));
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!centreId || !date) return;
    setBusy(true);
    try {
      await apiPost(`/v1/admin/centres/${centreId}/holidays`, {
        holiday_date: date,
        reason: reason.trim() || undefined,
        is_published: true,
      });
      toast.success('Holiday added.');
      setOpen(false);
      setCentreId(''); setDate(''); setReason('');
      onAdded();
    } catch (err) {
      toast.error('Failed.', err instanceof ApiError ? err.message : undefined);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />Add holiday</Button></DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Add holiday</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Centre *">
            <Select value={centreId} onValueChange={setCentreId}>
              <SelectTrigger><SelectValue placeholder="Select centre" /></SelectTrigger>
              <SelectContent>
                {centres.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Date *"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></FormRow>
          <FormRow label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Paryushan Parva" /></FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !centreId || !date}>{busy ? 'Saving…' : 'Add'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function HolidaysPage() {
  const [centres, setCentres] = useState<GeoOption[]>([]);
  const [centreId, setCentreId] = useState('');
  const [items, setItems] = useState<HolidayRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ items: GeoOption[] }>('/v1/admin/centres').then((r) => {
      const list = r?.items ?? [];
      setCentres(list);
      if (list[0]) setCentreId(list[0].id);
    });
  }, []);

  function reload() {
    if (!centreId) return;
    setLoading(true);
    setError(null);
    apiGet<{ items: Array<HolidayRow & { is_published?: boolean }> }>(
      `/v1/admin/centres/${centreId}/holidays`,
    )
      .then((r) => {
        const centreName = centres.find((c) => c.id === centreId)?.name ?? '';
        setItems((r?.items ?? []).map((h) => ({ ...h, centre_name: centreName })));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load holidays.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centreId, centres]);

  return (
    <AdminPageShell
      title="Holiday calendar"
      subtitle="AT30 — admin holidays nested under centre; public GET /v1/centres/:id/holidays is published-only."
      actions={
        <div className="flex items-center gap-2">
          <Select value={centreId} onValueChange={setCentreId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Centre" /></SelectTrigger>
            <SelectContent>
              {centres.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <AddHolidayDialog onAdded={reload} />
        </div>
      }
    >
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
interface GeoStateRow { id: string; name: string; code: string }
interface GeoCityRow { id: string; name: string; state_name: string }

function AddStateDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;
    setBusy(true);
    try {
      await apiPost('/v1/admin/states', { name: name.trim(), code: code.trim() });
      toast.success('State added.');
      setOpen(false);
      setName(''); setCode('');
      onAdded();
    } catch (err) {
      toast.error('Failed to add state.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="mr-1 h-4 w-4" />Add state</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add state</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="State name *">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Madhya Pradesh" required />
          </FormRow>
          <FormRow label="Code *">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. MP" required />
          </FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !name.trim() || !code.trim()}>
              {busy ? 'Saving…' : 'Add state'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddCityDialog({ states, onAdded }: { states: GeoStateRow[]; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stateId, setStateId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stateId || !name.trim() || !code.trim()) return;
    setBusy(true);
    try {
      await apiPost('/v1/admin/cities', { state_id: stateId, name: name.trim(), code: code.trim() });
      toast.success('City added.');
      setOpen(false);
      setStateId(''); setName(''); setCode('');
      onAdded();
    } catch (err) {
      toast.error('Failed to add city.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />Add city</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add city</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="State *">
            <Select value={stateId} onValueChange={setStateId}>
              <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent>
                {states.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="City name *">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Indore" required />
          </FormRow>
          <FormRow label="Code *">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. IDR" required />
          </FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !stateId || !name.trim() || !code.trim()}>
              {busy ? 'Saving…' : 'Add city'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GeographyPage() {
  const { user } = useAuth();
  const [states, setStates] = useState<GeoStateRow[]>([]);
  const [cities, setCities] = useState<GeoCityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    void apiGet<{ states: GeoStateRow[]; cities: GeoCityRow[] }>('/v1/admin/geography')
      .then((r) => {
        setStates(r?.states ?? []);
        setCities(r?.cities ?? []);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Geography is national reference data, so only super_admin may extend it —
  // the same rule the API enforces. Everyone else keeps the read-only view.
  const canEdit = user?.role === 'super_admin';

  return (
    <AdminPageShell
      title="Geography"
      subtitle="States and cities in the network."
      actions={canEdit ? (
        <div className="flex gap-2">
          <AddStateDialog onAdded={reload} />
          <AddCityDialog states={states} onAdded={reload} />
        </div>
      ) : undefined}
    >
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
