import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AdminEmptyRow,
  AdminError,
  AdminLoadMore,
  AdminPageShell,
  AdminTable,
} from '@/components/admin/AdminPageShell';
import { useAdminList } from '@/hooks/useAdminList';
import { useAuth } from '@/lib/auth-context';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast-jp';
import { roleSatisfies } from '@/components/admin/sidebar-nav';
import type { Role } from '@/lib/auth';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ImpersonateButton } from '@/components/admin/ImpersonateButton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { slugifyCityName } from '@jp/shared/city-slug';
import { formatSignedPoints } from '@/lib/punya-format';

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
  title_hi: string | null;
  description_en: string | null;
  description_hi: string | null;
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
  /** Campaign window — drives the mobile catalog's date-range and "ends in" chips. */
  start_date: string | null;
  end_date: string | null;
}

interface GeoStateOpt { id: string; name: string; }
interface GeoCityOpt { id: string; name: string; state_id: string; state_name?: string; }

/**
 * Create AND edit a niyam.
 *
 * Editing did not exist: the only mutation the page performed was the
 * is_active toggle, so a typo in a title or a wrong point value could only be
 * remedied by disabling the niyam and creating a replacement — which orphans
 * every submission, streak and badge already attached to the old id.
 *
 * `niyam_type` and geography stay immutable (the API's patchNiyamSchema omits
 * them): changing a niyam's frequency would invalidate every period_key already
 * recorded against it.
 */
function NiyamDialog({ niyam, onSaved }: { niyam?: NiyamRow; onSaved: () => void }) {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const editing = !!niyam;
  const defaultScope =
    role === 'city_admin' ? 'city' : role === 'state_admin' ? 'state' : 'national';

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [titleEn, setTitleEn] = useState('');
  const [titleHi, setTitleHi] = useState('');
  const [descEn, setDescEn] = useState('');
  const [descHi, setDescHi] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
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

  // Prefill from the row each time the dialog opens, so a cancelled edit does
  // not leave stale values behind for the next one.
  useEffect(() => {
    if (!open || !niyam) return;
    setTitleEn(niyam.title_en ?? '');
    setTitleHi(niyam.title_hi ?? '');
    setDescEn(niyam.description_en ?? '');
    setDescHi(niyam.description_hi ?? '');
    setStartDate(niyam.start_date ?? '');
    setEndDate(niyam.end_date ?? '');
    setNiyamType(niyam.niyam_type);
    setProofType(niyam.proof_type);
    setProofRequired(niyam.proof_required);
    setApprovalMode(niyam.approval_mode);
    setMaxUploads(String(niyam.max_uploads));
    setPoints(String(niyam.points));
    setIsActive(niyam.is_active);
    setScope(niyam.scope);
    setMsvAudience(niyam.msv_audience);
  }, [open, niyam]);

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
    if (endDate && startDate && endDate < startDate) {
      toast.error('End date is before the start date.');
      return;
    }
    if (!editing) {
      if (scope === 'state' && !stateId && role === 'super_admin') {
        toast.error('Select a state.');
        return;
      }
      if (scope === 'city' && !cityId && role !== 'city_admin') {
        toast.error('Select a city.');
        return;
      }
    }
    setBusy(true);
    try {
      // Hindi is sent as-typed, never defaulted to the English string. The API
      // used to store title_en into title_hi when this was blank, so the
      // `title_hi ?? title_en` fallback at every render site could never fire
      // and a child read English inside a Hindi UI with nothing flagging it.
      const common = {
        title_en: titleEn.trim(),
        // On edit, blank means "remove the Hindi title" (null); on create it
        // simply means "not supplied".
        title_hi: titleHi.trim() || (editing ? null : undefined),
        description_en: descEn.trim() || (editing ? null : undefined),
        description_hi: descHi.trim() || (editing ? null : undefined),
        proof_type: proofType,
        proof_required: proofRequired,
        approval_mode: approvalMode,
        max_uploads: Number(maxUploads),
        points: Number(points),
        is_active: isActive,
        msv_audience: msvAudience,
        // Asymmetric on purpose: niyams.start_date is NOT NULL DEFAULT
        // current_date, so it can never be cleared — blanking the field leaves
        // the stored value alone. end_date IS nullable, so blank means "remove
        // the closing date" (null) on edit.
        ...(startDate ? { start_date: startDate } : {}),
        end_date: endDate || (editing ? null : undefined),
      };

      if (editing) {
        await apiPatch(`/v1/admin/niyams/${niyam.id}`, common);
        toast.success('Niyam updated.');
      } else {
        await apiPost('/v1/admin/niyams', {
          ...common,
          niyam_type: niyamType,
          scope,
          ...(scope === 'state' && stateId ? { state_id: stateId } : {}),
          ...(scope === 'city' && cityId ? { city_id: cityId } : {}),
        });
        toast.success('Niyam created.');
      }
      setOpen(false);
      if (!editing) {
        setTitleEn(''); setTitleHi(''); setDescEn(''); setDescHi('');
        setStartDate(''); setEndDate('');
        setProofType('either'); setProofRequired(false); setApprovalMode('auto'); setMaxUploads('3');
        setScope(defaultScope);
        setMsvAudience('all');
      }
      onSaved();
    } catch (err) {
      toast.error('Failed.', err instanceof ApiError ? err.message : undefined);
    } finally { setBusy(false); }
  }

  const citiesForState = scope === 'city' && stateId
    ? cities.filter((c) => c.state_id === stateId)
    : cities;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button size="sm" variant="outline">Edit</Button>
        ) : (
          <Button size="sm"><Plus className="mr-1 h-4 w-4" />New niyam</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? 'Edit niyam' : 'Create niyam'}</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Title (English) *"><Input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} required /></FormRow>
          <FormRow label="Title (Hindi)">
            <Input value={titleHi} onChange={(e) => setTitleHi(e.target.value)} />
            {!titleHi.trim() ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Left blank, the app shows the English title to Hindi readers.
              </p>
            ) : null}
          </FormRow>
          <FormRow label="Description (English)"><Textarea rows={2} value={descEn} onChange={(e) => setDescEn(e.target.value)} /></FormRow>
          <FormRow label="Description (Hindi)"><Textarea rows={2} value={descHi} onChange={(e) => setDescHi(e.target.value)} /></FormRow>
          {/* Time-boxed niyams (Paryushan, a monthly sankalp) were unreachable:
              no UI sent these, so every niyam ran forever from today and the
              mobile catalog's date-range / "ends in" chips were dead code. */}
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Starts (IST)">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">
                {editing
                  ? 'Cannot be removed — leave blank to keep the current date.'
                  : 'Defaults to today.'}
              </p>
            </FormRow>
            <FormRow label="Ends (IST)">
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">
                {endDate ? 'Blank it to make this niyam run indefinitely.' : 'Runs indefinitely.'}
              </p>
            </FormRow>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Type">
              {/* Immutable after creation: every period_key already recorded
                  against this niyam was computed from its frequency. */}
              <Select value={niyamType} onValueChange={setNiyamType} disabled={editing}>
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
            {editing ? (
              <FormRow label="Geography">
                <p className="text-sm text-muted-foreground capitalize">
                  {niyam.scope}
                  {niyam.city_name ? ` · ${niyam.city_name}` : niyam.state_name ? ` · ${niyam.state_name}` : ''}
                </p>
              </FormRow>
            ) : (
              <FormRow label="Geography">
                <Select value={scope} onValueChange={(v) => { setScope(v); if (v === 'national') { setStateId(''); setCityId(''); } }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {scopeOptions.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormRow>
            )}
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
          {!editing && scope === 'state' && role === 'super_admin' ? (
            <FormRow label="State *">
              <Select value={stateId} onValueChange={setStateId}>
                <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent>
                  {states.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormRow>
          ) : null}
          {!editing && scope === 'city' && role !== 'city_admin' ? (
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
            <Button type="submit" disabled={busy || !titleEn.trim()}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Create'}
            </Button>
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
  const canAuthor = roleSatisfies((user?.role ?? 'guest') as Role, 'city_admin');
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
    <AdminPageShell
      title="Niyams"
      subtitle="Spiritual commitments catalogue."
      actions={canAuthor ? <NiyamDialog onSaved={reload} /> : undefined}
    >
      {!canAuthor ? (
        <p className="text-sm text-muted-foreground -mt-2">
          Niyams are set by city administrators and above.
        </p>
      ) : null}
      {error ? <AdminError message={error} /> : null}
      <AdminTable columns={['Title', 'Type', 'Proof', 'Approval', 'Uploads', 'Scope', 'Audience', 'Points', 'Window', 'Active', '']} loading={loading} empty="" colSpan={11}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={11} message="No niyams defined." /> : null}
        {items.map((n) => {
          const canToggle = canToggleNiyam(user?.role, n, user?.state_id, user?.city_id);
          return (
            <tr key={n.id} className="hover:bg-muted/30">
              <td className="px-4 py-3">
                <div className="font-medium">
                  {n.title_en}
                  {/* Flags both "never translated" (null) and the legacy rows the
                      API used to create by copying title_en into title_hi — a
                      child on the Hindi UI reads English in either case. */}
                  {!n.title_hi || n.title_hi === n.title_en ? (
                    <span className="ml-2 rounded-full bg-status-warning-soft px-2 py-0.5 text-xs font-medium text-status-warning">
                      Hindi missing
                    </span>
                  ) : null}
                </div>
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
              <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                {n.start_date || n.end_date
                  ? `${n.start_date ?? '—'} → ${n.end_date ?? '∞'}`
                  : '—'}
              </td>
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
              <td className="px-4 py-3">
                {canToggle ? <NiyamDialog niyam={n} onSaved={reload} /> : null}
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
  /** null = a GLOBAL default applying to every city. */
  city_id: string | null;
  city_name: string | null;
}

interface PunyaFeatureOpt {
  key: string;
  label: string;
  min_points: number | null;
  max_points: number | null;
}

function AddPunyaConfigDialog({ onAdded }: { onAdded: () => void }) {
  const { user } = useAuth();
  const isSuper = user?.role === 'super_admin';
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [featureKey, setFeatureKey] = useState('');
  const [points, setPoints] = useState('10');
  const [isActive, setIsActive] = useState(true);
  const [features, setFeatures] = useState<PunyaFeatureOpt[]>([]);
  // super_admin only: '' = this admin's city (n/a for super), 'global' = every city.
  const [globalScope, setGlobalScope] = useState(false);
  const [cityId, setCityId] = useState('');
  const [cityOpts, setCityOpts] = useState<GeoCityOpt[]>([]);

  useEffect(() => {
    if (!open) return;
    void apiGet<{ items: PunyaFeatureOpt[] }>('/v1/admin/punya/features').then((r) =>
      setFeatures(r?.items ?? []),
    );
    if (isSuper) {
      void apiGet<{ states: GeoStateOpt[]; cities: GeoCityOpt[] }>('/v1/admin/geography').then((r) =>
        setCityOpts(r?.cities ?? []),
      );
    }
  }, [open, isSuper]);

  const selectedFeature = features.find((f) => f.key === featureKey) ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!featureKey.trim()) return;
    setBusy(true);
    try {
      await apiPost('/v1/admin/punya/configs', {
        feature_key: featureKey.trim(),
        points: Number(points),
        is_active: isActive,
        // Omitted → the API defaults to the caller's own city. Only a
        // super_admin may write the global (null) row that re-prices everywhere.
        ...(isSuper ? { city_id: globalScope ? null : cityId || null } : {}),
      });
      toast.success('Punya config created.');
      setOpen(false);
      setFeatureKey(''); setPoints('10'); setIsActive(true);
      setGlobalScope(false); setCityId('');
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
          {/* Was a free-text box: a typo produced a config nothing ever reads,
              silently. The key must name a registered punya_features row. */}
          <FormRow label="Feature *">
            <Select value={featureKey} onValueChange={setFeatureKey}>
              <SelectTrigger><SelectValue placeholder="Select a feature" /></SelectTrigger>
              <SelectContent>
                {features.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label} <span className="font-mono text-xs text-muted-foreground">({f.key})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          {isSuper ? (
            <>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={globalScope}
                  onChange={(e) => { setGlobalScope(e.target.checked); if (e.target.checked) setCityId(''); }}
                  className="rounded"
                />
                Apply to every city (global default)
              </label>
              {!globalScope ? (
                <FormRow label="City *">
                  <Select value={cityId} onValueChange={setCityId}>
                    <SelectTrigger><SelectValue placeholder="Select city" /></SelectTrigger>
                    <SelectContent>
                      {cityOpts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormRow>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              This value applies to your city only. Global defaults are set by a super admin.
            </p>
          )}
          <FormRow label="Points">
            <Input type="number" min={0} value={points} onChange={(e) => setPoints(e.target.value)} />
            {selectedFeature && (selectedFeature.min_points != null || selectedFeature.max_points != null) ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Allowed: {selectedFeature.min_points ?? 0}–{selectedFeature.max_points ?? '∞'}
              </p>
            ) : null}
          </FormRow>
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

/**
 * Inline row editor (CTY-API-09) — configs were create-only, so a mis-entered
 * point value could never be corrected or switched off.
 */
function PunyaConfigRowView({ c, onSaved }: { c: PunyaConfigRow; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [points, setPoints] = useState(String(c.points));
  const [busy, setBusy] = useState(false);

  async function save(next: { points?: number; is_active?: boolean }) {
    setBusy(true);
    try {
      await apiPatch(`/v1/admin/punya/configs/${c.id}`, next);
      toast.success('Punya config updated.');
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error('Could not update the config.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="hover:bg-muted/30">
      <td className="px-4 py-3 font-mono text-xs">{c.feature_key}</td>
      {/* Scope was invisible: a global row and a city override rendered
          identically, so nobody could tell which one was re-pricing what. */}
      <td className="px-4 py-3 text-xs">
        {c.city_id ? (
          c.city_name ?? 'City'
        ) : (
          <span className="rounded-full bg-status-warning-soft px-2 py-0.5 font-medium text-status-warning">
            Global — every city
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={10000}
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              className="h-8 w-24"
            />
            <Button size="sm" disabled={busy} onClick={() => void save({ points: Number(points) })}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setPoints(String(c.points));
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          c.points
        )}
      </td>
      <td className="px-4 py-3">
        <Switch
          checked={c.is_active}
          disabled={busy}
          onCheckedChange={(v) => void save({ is_active: v })}
        />
      </td>
      <td className="px-4 py-3">
        {!editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

export function PunyaConfigsPage() {
  const { items, loading, error, reload } = useAdminList<PunyaConfigRow>('/v1/admin/punya/configs');
  return (
    <AdminPageShell title="Punya configs" subtitle="Point values per feature key." actions={<AddPunyaConfigDialog onAdded={reload} />}>
      {error ? <AdminError message={error} /> : null}
      <AdminTable columns={['Feature', 'Scope', 'Points', 'Active', 'Actions']} loading={loading} empty="" colSpan={5}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={5} message="No configs." /> : null}
        {items.map((c) => (
          <PunyaConfigRowView key={c.id} c={c} onSaved={reload} />
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
            {/* Reversals are real ledger rows with negative points (a niyam
                rejection, an attendance correction). A hardcoded '+' rendered
                them as '+-10' and coloured them like a credit. */}
            <td
              className={
                t.points < 0
                  ? 'px-4 py-3 font-semibold text-destructive'
                  : 'px-4 py-3 font-semibold text-primary'
              }
            >
              {formatSignedPoints(t.points)}
            </td>
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

interface AwardLimitInfo {
  max_points_per_award: number | null;
  max_points_per_day: number | null;
  points_awarded_today: number;
  remaining_today: number | null;
}

export function PunyaAwardPage() {
  const [students, setStudents] = useState<AwardStudentOption[]>([]);
  const [studentQuery, setStudentQuery] = useState('');
  const [selected, setSelected] = useState<AwardStudentOption | null>(null);
  const [points, setPoints] = useState('10');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // Role cap + remaining-today up front (SAN-API-08) — the server used to
  // reject over-cap awards only after the whole form was submitted.
  const [limitInfo, setLimitInfo] = useState<AwardLimitInfo | null>(null);
  const [awardKey, setAwardKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    void apiGet<AwardLimitInfo>('/v1/admin/punya/award-limit')
      .then((r) => setLimitInfo(r ?? null))
      .catch(() => setLimitInfo(null));
  }, []);

  const maxAllowed = (() => {
    if (!limitInfo) return 500;
    const caps = [limitInfo.max_points_per_award, limitInfo.remaining_today].filter(
      (v): v is number => typeof v === 'number',
    );
    return caps.length ? Math.min(500, ...caps) : 500;
  })();

  // Server-side ?q= search — the old 500-row <Select> could not reach a
  // student beyond the first page, so they could never be awarded
  // (CTY-PRF-02).
  useEffect(() => {
    const q = studentQuery.trim();
    const t = window.setTimeout(() => {
      const url = q
        ? `/v1/admin/students?limit=20&q=${encodeURIComponent(q)}`
        : '/v1/admin/students?limit=20';
      void apiGet<{ items: AwardStudentOption[] }>(url).then((r) => setStudents(r?.items ?? []));
    }, 300);
    return () => window.clearTimeout(t);
  }, [studentQuery]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      const res = await apiPost<{ total_points: number; tier: string }>('/v1/admin/punya/award', {
        student_id: selected.id,
        points: Number(points),
        note: note.trim() || undefined,
        // De-dupe token: a double-clicked submit or retried request must not
        // award twice (SAN-API-08).
        idempotency_key: `manual:${awardKey}`,
      });
      toast.success(`Awarded ${points} Punya. New total: ${res.total_points} (${res.tier}).`);
      setNote('');
      setAwardKey(crypto.randomUUID());
      // Refresh remaining-today after a successful award.
      void apiGet<AwardLimitInfo>('/v1/admin/punya/award-limit')
        .then((r) => setLimitInfo(r ?? null))
        .catch(() => {});
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
            <Label htmlFor="student_search">Student</Label>
            {selected ? (
              <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                <span>
                  {selected.full_name ?? 'Unnamed'} — {selected.student_code}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected(null)}
                >
                  Change
                </Button>
              </div>
            ) : (
              <>
                <Input
                  id="student_search"
                  value={studentQuery}
                  onChange={(e) => setStudentQuery(e.target.value)}
                  placeholder="Search by name or student code"
                  className="mt-1"
                />
                <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                  {students.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left text-sm hover:border-primary/40"
                      onClick={() => setSelected(s)}
                    >
                      <span>{s.full_name ?? 'Unnamed'}</span>
                      <span className="font-mono text-xs text-muted-foreground">{s.student_code}</span>
                    </button>
                  ))}
                  {students.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-muted-foreground">
                      No students match — try a name or code.
                    </p>
                  ) : null}
                </div>
              </>
            )}
          </div>
          <div>
            <Label htmlFor="points">Points</Label>
            <Input
              id="points"
              type="number"
              min={1}
              max={maxAllowed}
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              className="mt-1"
            />
            {limitInfo ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {limitInfo.max_points_per_award != null
                  ? `Up to ${limitInfo.max_points_per_award} per award. `
                  : ''}
                {limitInfo.remaining_today != null
                  ? `${limitInfo.remaining_today} of ${limitInfo.max_points_per_day} left today.`
                  : 'No daily cap for your role.'}
              </p>
            ) : null}
            {Number(points) > maxAllowed ? (
              <p className="mt-1 text-xs text-destructive">
                Over your cap — enter {maxAllowed} or less.
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="note">Note (optional)</Label>
            <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} className="mt-1" />
          </div>
          <Button type="submit" disabled={busy || !selected || Number(points) > maxAllowed || Number(points) < 1}>
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
      <AdminTable columns={['Name', 'Phone', 'Batches', '']} loading={loading} empty="" colSpan={4}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={4} message="No shikshaks in scope." /> : null}
        {items.map((s) => (
          <tr key={s.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">{s.full_name}</td>
            <td className="px-4 py-3 text-xs">{s.phone}</td>
            <td className="px-4 py-3">{s.batch_count}</td>
            <td className="px-4 py-3">
              {/* Renders only for super_admin (SUP-API-03). */}
              <ImpersonateButton userId={s.id} name={s.full_name} role="shikshak" />
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
  is_published: boolean;
  restorable_session_count: number;
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

function HolidayActions({
  centreId,
  holiday,
  onChanged,
}: {
  centreId: string;
  holiday: HolidayRow;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function togglePublished() {
    setBusy(true);
    try {
      await apiPatch(`/v1/admin/centres/${centreId}/holidays/${holiday.id}`, {
        is_published: !holiday.is_published,
      });
      toast.success(holiday.is_published ? 'Holiday unpublished.' : 'Holiday published.');
      onChanged();
    } catch (err) {
      toast.error('Could not update holiday.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const n = holiday.restorable_session_count;
    const okConfirm = window.confirm(
      `Delete the holiday on ${holiday.holiday_date}?\n\nThis will restore ${n} cancelled session${n === 1 ? '' : 's'} for this centre.`,
    );
    if (!okConfirm) return;
    setBusy(true);
    try {
      const res = await apiDelete<{ sessions_restored: number }>(
        `/v1/admin/centres/${centreId}/holidays/${holiday.id}`,
      );
      toast.success(
        `Holiday removed. Restored ${res?.sessions_restored ?? n} session${(res?.sessions_restored ?? n) === 1 ? '' : 's'}.`,
      );
      onChanged();
    } catch (err) {
      toast.error('Could not delete holiday.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void togglePublished()}>
        {holiday.is_published ? 'Unpublish' : 'Publish'}
      </Button>
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove()}>
        Delete
      </Button>
    </div>
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
    apiGet<{
      items: Array<{
        id: string;
        holiday_date: string;
        reason: string | null;
        is_published?: boolean;
        restorable_session_count?: number;
      }>;
    }>(`/v1/admin/centres/${centreId}/holidays`)
      .then((r) => {
        const centreName = centres.find((c) => c.id === centreId)?.name ?? '';
        setItems(
          (r?.items ?? []).map((h) => ({
            id: h.id,
            holiday_date: h.holiday_date,
            reason: h.reason,
            centre_name: centreName,
            is_published: h.is_published ?? true,
            restorable_session_count: h.restorable_session_count ?? 0,
          })),
        );
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
      subtitle="Centre holidays — published dates also appear to families on the centre's public page."
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
      <AdminTable columns={['Centre', 'Date', 'Reason', 'Published', 'Actions']} loading={loading} empty="" colSpan={5}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={5} message="No holidays scheduled." /> : null}
        {items.map((h) => (
          <tr key={h.id} className="hover:bg-muted/30">
            <td className="px-4 py-3">{h.centre_name}</td>
            <td className="px-4 py-3 text-xs">{h.holiday_date}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{h.reason ?? '—'}</td>
            <td className="px-4 py-3 text-xs">{h.is_published ? 'Yes' : 'No'}</td>
            <td className="px-4 py-3">
              {centreId ? (
                <HolidayActions centreId={centreId} holiday={h} onChanged={reload} />
              ) : null}
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

/** Previous calendar month in Asia/Kolkata as YYYY-MM (matches report cron). */
function lastCompletedMonthYmIst(): string {
  const nowYm = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
  const [ys, ms] = nowYm.split('-');
  const y = Number(ys);
  const m = Number(ms);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function ReportsPage() {
  const { user } = useAuth();
  const [centres, setCentres] = useState<GeoOption[]>([]);
  const [centresLoaded, setCentresLoaded] = useState(false);
  const [centreId, setCentreId] = useState('');
  const [month, setMonth] = useState(lastCompletedMonthYmIst);
  const [items, setItems] = useState<
    Array<{
      id: string;
      month: string;
      status: string;
      pdf_url: string | null;
      error_message: string | null;
      created_at: string;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const pendingSince = useRef<number | null>(null);

  const maxMonth = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
  const canGenerateAll =
    centres.length > 1 && roleSatisfies((user?.role ?? 'guest') as Role, 'city_admin');

  useEffect(() => {
    void apiGet<{ items: GeoOption[] }>('/v1/admin/centres')
      .then((r) => {
        const list = r?.items ?? [];
        setCentres(list);
        if (list[0]) setCentreId(list[0].id);
      })
      .catch(() => setError('Could not load centres.'))
      .finally(() => setCentresLoaded(true));
  }, []);

  const reload = useCallback(() => {
    if (!centreId || !/^\d{4}-\d{2}$/.test(month)) return;
    setLoading(true);
    setError(null);
    apiGet<{ items: typeof items }>(
      `/v1/admin/centres/${centreId}/reports?month=${encodeURIComponent(month)}`,
    )
      .then((r) => setItems(r?.items ?? []))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load reports.'))
      .finally(() => setLoading(false));
  }, [centreId, month]);

  useEffect(() => {
    reload();
  }, [reload]);

  const pending = items.some((r) => r.status === 'queued' || r.status === 'generating');

  useEffect(() => {
    if (!pending) {
      pendingSince.current = null;
      return;
    }
    if (pendingSince.current == null) pendingSince.current = Date.now();
    const t = setInterval(() => reload(), 2000);
    return () => clearInterval(t);
  }, [pending, reload]);

  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(t);
  }, [pending]);

  const stuckWaiting =
    pending && pendingSince.current != null && nowTick - pendingSince.current > 30_000;

  async function generateOne(id: string): Promise<void> {
    await apiPost(`/v1/admin/centres/${id}/reports/monthly`, { month });
  }

  async function onGenerate() {
    if (!centreId) return;
    setGenerating(true);
    setError(null);
    try {
      await generateOne(centreId);
      toast.success('Report queued — it will appear below when ready.');
      reload();
    } catch (err) {
      toast.error(
        'Could not generate report.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setGenerating(false);
    }
  }

  async function onGenerateAll() {
    if (centres.length === 0) return;
    setGenerating(true);
    setError(null);
    let okCount = 0;
    let failCount = 0;
    let lastErr: string | undefined;
    for (const c of centres) {
      try {
        await generateOne(c.id);
        okCount += 1;
      } catch (err) {
        failCount += 1;
        lastErr = err instanceof ApiError ? err.message : undefined;
      }
    }
    if (okCount > 0) {
      toast.success(
        failCount > 0
          ? `Queued ${okCount} of ${centres.length} reports.`
          : `Queued reports for ${okCount} Pathshalas.`,
      );
      reload();
    }
    if (failCount > 0) {
      toast.error('Could not generate every report.', lastErr);
    }
    setGenerating(false);
  }

  const busy = generating || pending;
  const noCentres = centresLoaded && centres.length === 0;

  return (
    <AdminPageShell
      title="Reports"
      subtitle="Monthly centre PDF for trustees — attendance, Niyam, homework, Punya (no student names)."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Select value={centreId} onValueChange={setCentreId} disabled={noCentres}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder={noCentres ? 'No Pathshala' : 'Select centre'} />
            </SelectTrigger>
            <SelectContent>
              {centres.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="month"
            className="w-40"
            max={maxMonth}
            value={month}
            onChange={(e) => {
              const v = e.target.value;
              if (v && v <= maxMonth) setMonth(v);
            }}
          />
          <Button size="sm" onClick={() => void onGenerate()} disabled={!centreId || busy}>
            {busy ? 'Generating…' : 'Generate'}
          </Button>
          {canGenerateAll ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onGenerateAll()}
              disabled={busy}
            >
              Generate for all centres
            </Button>
          ) : null}
        </div>
      }
    >
      {noCentres ? (
        <AdminError message="No Pathshala in your city — ask a state admin to assign your city." />
      ) : null}
      {error ? <AdminError message={error} /> : null}
      {stuckWaiting ? (
        <AdminError message="Report is waiting on the worker — check that the API worker is running." />
      ) : null}
      <AdminTable
        columns={['Month', 'Status', 'Created', 'Download']}
        loading={loading}
        empty=""
        colSpan={4}
      >
        {items.length === 0 && !loading ? (
          <AdminEmptyRow colSpan={4} message="No reports for this month yet." />
        ) : null}
        {items.map((r) => (
          <tr key={r.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 text-xs font-medium">{r.month}</td>
            <td className="px-4 py-3 text-xs capitalize">
              {r.status}
              {r.error_message ? (
                <div className="text-destructive mt-1">{r.error_message}</div>
              ) : null}
            </td>
            <td className="px-4 py-3 text-xs text-muted-foreground">
              {r.created_at ? new Date(r.created_at).toLocaleString('en-IN') : '—'}
            </td>
            <td className="px-4 py-3">
              {r.status === 'ready' && r.pdf_url ? (
                <a
                  href={r.pdf_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  Download PDF
                </a>
              ) : r.status === 'queued' || r.status === 'generating' ? (
                <span className="text-xs text-muted-foreground">Generating…</span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

/* ——— System ——— */
interface GeoStateRow { id: string; name: string; code: string }
interface GeoCityRow {
  id: string;
  name: string;
  code: string;
  slug: string;
  state_id: string;
  state_name: string;
  state_code?: string;
}

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
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  function onNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugifyCityName(value));
  }

  function reset() {
    setStateId('');
    setName('');
    setCode('');
    setSlug('');
    setSlugTouched(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedSlug = slug.trim().toLowerCase();
    if (!stateId || !name.trim() || !code.trim() || !trimmedSlug) return;
    setBusy(true);
    try {
      await apiPost('/v1/admin/cities', {
        state_id: stateId,
        name: name.trim(),
        code: code.trim(),
        slug: trimmedSlug,
      });
      toast.success('City added.');
      setOpen(false);
      reset();
      onAdded();
    } catch (err) {
      toast.error('Failed to add city.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
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
            <Input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="e.g. Indore"
              required
            />
          </FormRow>
          <FormRow label="Code *">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. IDR" required />
          </FormRow>
          <FormRow label="Slug *">
            <Input
              value={slug}
              onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }}
              placeholder="e.g. indore"
              required
            />
            <p className="text-[11px] text-muted-foreground">
              Public URL key — unique across all cities. Auto-filled from the name until you edit it.
            </p>
          </FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !stateId || !name.trim() || !code.trim() || !slug.trim()}>
              {busy ? 'Saving…' : 'Add city'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditCityDialog({
  city,
  open,
  onOpenChange,
  onSaved,
}: {
  city: GeoCityRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [slug, setSlug] = useState('');

  useEffect(() => {
    if (!city || !open) return;
    setName(city.name);
    setCode(city.code);
    setSlug(city.slug);
  }, [city, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!city) return;
    const trimmedSlug = slug.trim().toLowerCase();
    if (!name.trim() || !code.trim() || !trimmedSlug) return;
    setBusy(true);
    try {
      await apiPatch(`/v1/admin/cities/${city.id}`, {
        name: name.trim(),
        code: code.trim(),
        slug: trimmedSlug,
      });
      toast.success('City updated.');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error('Failed to update city.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Edit city</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="City name *">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </FormRow>
          <FormRow label="Code *">
            <Input value={code} onChange={(e) => setCode(e.target.value)} required />
          </FormRow>
          <FormRow label="Slug *">
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              required
            />
            <p className="text-[11px] text-muted-foreground">
              Changing the slug updates public Centre Locator / Team routes for this city.
            </p>
          </FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !name.trim() || !code.trim() || !slug.trim()}>
              {busy ? 'Saving…' : 'Save'}
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
  const [editCity, setEditCity] = useState<GeoCityRow | null>(null);

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
      subtitle={
        canEdit
          ? 'States and cities in the network.'
          : // Buttons were simply absent with no explanation — a state_admin
            // could not tell broken from restricted (STA-DSN-01).
            'States and cities in the network. Read-only for your role — only the national (super) admin can add or edit geography.'
      }
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
        <AdminTable columns={['City', 'Slug', 'State', '']} loading={loading} empty="" colSpan={4}>
          {cities.length === 0 && !loading ? <AdminEmptyRow colSpan={4} message="No cities." /> : null}
          {cities.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-3">{c.name}</td>
              <td className="px-4 py-3 font-mono text-xs">{c.slug}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{c.state_name}</td>
              <td className="px-4 py-3 text-right">
                {canEdit ? (
                  <Button size="sm" variant="ghost" onClick={() => setEditCity(c)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </AdminTable>
      </div>
      <EditCityDialog
        city={editCity}
        open={editCity !== null}
        onOpenChange={(v) => { if (!v) setEditCity(null); }}
        onSaved={reload}
      />
    </AdminPageShell>
  );
}

interface SettingRow {
  key: string;
  value: string | null;
  updated_at: string;
}

/** Keys the PATCH endpoint accepts (client + platform allowlists). */
const WRITABLE_SETTING_KEYS = [
  'gallery_carousel_interval_ms',
  'eighty_g_enabled',
  'eighty_g_registration_number',
  'organization_pan',
];

/** Inline value editor for one writable setting row (SUP-API-01). */
function SettingRowView({ s, canEdit, onSaved }: { s: SettingRow; canEdit: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(s.value ?? '');
  const [busy, setBusy] = useState(false);
  const writable = canEdit && WRITABLE_SETTING_KEYS.includes(s.key);

  async function save() {
    setBusy(true);
    try {
      await apiPatch('/v1/admin/settings', { key: s.key, value });
      toast.success(`Setting ${s.key} updated.`);
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error('Could not update the setting.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="hover:bg-muted/30">
      <td className="px-4 py-3 font-mono text-xs">{s.key}</td>
      <td className="px-4 py-3 text-xs max-w-md">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-8" />
            <Button size="sm" disabled={busy} onClick={() => void save()}>Save</Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setValue(s.value ?? '');
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <span className="block truncate">{s.value ?? '—'}</span>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {new Date(s.updated_at).toLocaleDateString('en-GB')}
      </td>
      <td className="px-4 py-3">
        {writable && !editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
        ) : null}
      </td>
    </tr>
  );
}

/**
 * Q3 — 80G configuration card. The toggle is server-enforced: enabling
 * requires both the registration number and the organisation PAN.
 */
function EightyGCard({ items, onSaved }: { items: SettingRow[]; onSaved: () => void }) {
  const get = (key: string) => items.find((s) => s.key === key)?.value ?? '';
  const enabled = get('eighty_g_enabled').toLowerCase() === 'true';
  const [regNo, setRegNo] = useState(get('eighty_g_registration_number'));
  const [pan, setPan] = useState(get('organization_pan'));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRegNo(get('eighty_g_registration_number'));
    setPan(get('organization_pan'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  async function patch(key: string, value: string) {
    await apiPatch('/v1/admin/settings', { key, value });
  }

  async function saveFields() {
    setBusy(true);
    try {
      await patch('eighty_g_registration_number', regNo.trim());
      await patch('organization_pan', pan.trim());
      toast.success('80G details saved.');
      onSaved();
    } catch (err) {
      toast.error('Could not save the 80G details.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await patch('eighty_g_enabled', next ? 'true' : 'false');
      toast.success(next ? '80G receipts enabled.' : '80G receipts disabled.', next
        ? 'New captured donations will be stamped 80G-eligible.'
        : 'Existing receipts are kept; new donations will not claim 80G.');
      onSaved();
    } catch (err) {
      toast.error('Could not change the 80G toggle.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-xl p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">80G donation receipts</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Off by default. Enabling requires the 80G registration number and organisation PAN —
            both are printed on every eligible receipt. Turning it off keeps existing receipts.
          </p>
        </div>
        <Switch checked={enabled} disabled={busy} onCheckedChange={(v) => void toggle(v)} />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs font-medium">80G registration number</Label>
          <Input value={regNo} onChange={(e) => setRegNo(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs font-medium">Organisation PAN</Label>
          <Input value={pan} onChange={(e) => setPan(e.target.value)} className="mt-1" />
        </div>
      </div>
      <Button size="sm" className="mt-3" disabled={busy} onClick={() => void saveFields()}>
        Save 80G details
      </Button>
    </Card>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const { items, loading, error, reload } = useAdminList<SettingRow>('/v1/admin/settings');
  const canEdit = user?.role === 'super_admin';
  return (
    <AdminPageShell
      title="Settings"
      subtitle={
        canEdit
          ? 'Platform configuration keys.'
          : // STA-DSN-01 — name the restriction instead of silently hiding it.
            'Platform configuration keys. Read-only for your role — only the national (super) admin can change settings.'
      }
    >
      {error ? <AdminError message={error} /> : null}
      {canEdit ? <EightyGCard items={items} onSaved={() => void reload()} /> : null}
      <AdminTable columns={['Key', 'Value', 'Updated', '']} loading={loading} empty="" colSpan={4}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={4} message="No settings." /> : null}
        {items.map((s) => (
          <SettingRowView key={s.key} s={s} canEdit={canEdit} onSaved={() => void reload()} />
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}
