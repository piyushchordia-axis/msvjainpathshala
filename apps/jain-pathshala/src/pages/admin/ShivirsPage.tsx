/**
 * Admin shivirs list.
 *
 * Lifted out of AdminListPages.tsx because creation used to be the only write
 * this module had: a typo in the name, a venue change or a cancelled camp was
 * permanent and stayed on the public site until end_date. It now carries edit,
 * publish/unpublish, cancel, MSV and contact fields, search, a published filter
 * and paging — plus a link into the per-shivir page, which the inert rows never
 * offered.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { apiGet, apiPatch, apiPost, apiDelete, ApiError } from '@/lib/api-client';
import { useAdminList } from '@/hooks/useAdminList';
import { useAuth } from '@/lib/auth-context';
import { toast } from '@/components/ui/toast-jp';
import {
  AdminPageShell,
  AdminTable,
  AdminError,
  AdminEmptyRow,
  AdminLoadMore,
} from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Plus, Search, Pencil } from 'lucide-react';

export interface AdminShivirRow {
  id: string;
  name_en: string;
  name_hi: string | null;
  description_en: string | null;
  description_hi: string | null;
  start_date: string;
  end_date: string;
  location_text: string | null;
  contact_info: string | null;
  city_id: string;
  city_name: string;
  is_published: boolean;
  msv_only: boolean;
  attendance_mode: 'in_out' | 'present_only';
  capacity: number | null;
}

interface GeoOption {
  id: string;
  name: string;
  state_id?: string;
  state_name?: string;
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

function fmtDate(d: string): string {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB');
}

/** Create and edit share one form — the fields are identical bar the city. */
function ShivirDialog({
  existing,
  onSaved,
  trigger,
}: {
  existing?: AdminShivirRow;
  onSaved: () => void;
  trigger: React.ReactNode;
}) {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cities, setCities] = useState<GeoOption[]>([]);

  const [nameEn, setNameEn] = useState(existing?.name_en ?? '');
  const [nameHi, setNameHi] = useState(existing?.name_hi ?? '');
  const [cityId, setCityId] = useState(existing?.city_id ?? '');
  const [startDate, setStartDate] = useState(existing?.start_date ?? '');
  const [endDate, setEndDate] = useState(existing?.end_date ?? '');
  const [location, setLocation] = useState(existing?.location_text ?? '');
  const [contact, setContact] = useState(existing?.contact_info ?? '');
  const [capacity, setCapacity] = useState(existing?.capacity ? String(existing.capacity) : '');
  const [descriptionEn, setDescriptionEn] = useState(existing?.description_en ?? '');
  const [descriptionHi, setDescriptionHi] = useState(existing?.description_hi ?? '');
  const [mode, setMode] = useState<'in_out' | 'present_only'>(
    existing?.attendance_mode ?? 'present_only',
  );
  const [msvOnly, setMsvOnly] = useState(existing?.msv_only ?? false);
  const [published, setPublished] = useState(existing?.is_published ?? false);

  useEffect(() => {
    if (!open || existing) return;
    void apiGet<{ cities: GeoOption[] }>('/v1/admin/geography').then((r) => {
      // Narrow to what this admin may actually create in. Offering every city
      // in India and then 403-ing on submit teaches nothing until it is too
      // late — same pattern the niyam dialog already uses.
      let list = r?.cities ?? [];
      if (role === 'state_admin' && user?.state_id) {
        list = list.filter((c) => c.state_id === user.state_id);
      }
      if (role === 'city_admin' && user?.city_id) {
        list = list.filter((c) => c.id === user.city_id);
      }
      setCities(list);
      if (list.length === 1) setCityId(list[0]!.id);
    });
  }, [open, existing, role, user?.state_id, user?.city_id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!nameEn.trim()) return;
    if (!existing && !cityId) return;
    if (endDate && startDate && endDate < startDate) {
      toast.error('End date is before the start date.', 'Check the shivir dates and try again.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name_en: nameEn.trim(),
        name_hi: nameHi.trim() || null,
        description_en: descriptionEn.trim() || null,
        description_hi: descriptionHi.trim() || null,
        start_date: startDate,
        end_date: endDate,
        location_text: location.trim() || null,
        contact_info: contact.trim() || null,
        capacity: capacity ? Number(capacity) : null,
        attendance_mode: mode,
        msv_only: msvOnly,
        is_published: published,
      };
      if (existing) {
        await apiPatch(`/v1/admin/shivirs/${existing.id}`, payload);
        toast.success('Shivir updated.');
      } else {
        await apiPost('/v1/admin/shivirs', { ...payload, city_id: cityId });
        toast.success(
          published ? 'Shivir created and published.' : 'Shivir saved as a draft.',
          published ? undefined : 'It stays off the public site until you publish it.',
        );
      }
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(
        existing ? 'Failed to update shivir.' : 'Failed to create shivir.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit shivir' : 'New shivir'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <FormRow label="Name (English)">
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
          </FormRow>
          <FormRow label="Name (Hindi)">
            <Input
              value={nameHi}
              onChange={(e) => setNameHi(e.target.value)}
              placeholder="Devanagari — optional, falls back to English"
            />
          </FormRow>
          {!existing ? (
            <FormRow label="City">
              <Select value={cityId} onValueChange={setCityId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select city" />
                </SelectTrigger>
                <SelectContent>
                  {cities.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.state_name ? ` (${c.state_name})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Start date">
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </FormRow>
            <FormRow label="End date">
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </FormRow>
          </div>
          <FormRow label="Location / venue">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          </FormRow>
          <FormRow label="Contact">
            <Input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Phone or email shown on the public page"
            />
          </FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Capacity">
              <Input
                type="number"
                min={1}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </FormRow>
            <FormRow label="Attendance mode">
              <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="present_only">Present only</SelectItem>
                  <SelectItem value="in_out">Check in / check out</SelectItem>
                </SelectContent>
              </Select>
            </FormRow>
          </div>
          <FormRow label="Description (English)">
            <Textarea
              rows={2}
              value={descriptionEn}
              onChange={(e) => setDescriptionEn(e.target.value)}
            />
          </FormRow>
          <FormRow label="Description (Hindi)">
            <Textarea
              rows={2}
              value={descriptionHi}
              onChange={(e) => setDescriptionHi(e.target.value)}
            />
          </FormRow>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={msvOnly} onCheckedChange={(v) => setMsvOnly(v === true)} />
            MSV students only
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={published} onCheckedChange={(v) => setPublished(v === true)} />
            Published (visible on the public site)
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !nameEn.trim() || (!existing && !cityId)}>
              {busy ? 'Saving…' : existing ? 'Save changes' : 'Create shivir'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ShivirsPage() {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const canAuthor = role === 'super_admin' || role === 'state_admin' || role === 'city_admin';

  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [publishedFilter, setPublishedFilter] = useState<'all' | 'true' | 'false'>('all');

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  // useMemo because useAdminList keys its fetch callback on the path string.
  const listUrl = useMemo(() => {
    const params = new URLSearchParams({ limit: '100' });
    if (searchDebounced) params.set('q', searchDebounced);
    if (publishedFilter !== 'all') params.set('is_published', publishedFilter);
    return `/v1/admin/shivirs?${params.toString()}`;
  }, [searchDebounced, publishedFilter]);

  const { items, loading, loadingMore, error, hasMore, reload, loadMore } =
    useAdminList<AdminShivirRow>(listUrl);

  async function togglePublish(row: AdminShivirRow) {
    try {
      await apiPatch(`/v1/admin/shivirs/${row.id}`, { is_published: !row.is_published });
      toast.success(row.is_published ? 'Shivir unpublished.' : 'Shivir published.');
      reload();
    } catch (err) {
      toast.error('Failed to change publication.', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function cancelShivir(row: AdminShivirRow) {
    try {
      await apiDelete(`/v1/admin/shivirs/${row.id}`);
      toast.success(
        'Shivir cancelled.',
        'It is off the public site. Registrations and scans are kept on record.',
      );
      reload();
    } catch (err) {
      toast.error('Failed to cancel shivir.', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <AdminPageShell
      title="Shivirs"
      subtitle="Residential and day camps in your scope."
      actions={
        canAuthor ? (
          <ShivirDialog
            onSaved={reload}
            trigger={
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" />
                New shivir
              </Button>
            }
          />
        ) : undefined
      }
    >
      {error ? <AdminError message={error} /> : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="w-64 pl-8"
            placeholder="Search by name, venue or city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={publishedFilter}
          onValueChange={(v) => setPublishedFilter(v as typeof publishedFilter)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="true">Published</SelectItem>
            <SelectItem value="false">Drafts</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <AdminTable
        columns={['Name', 'Dates', 'City', 'Capacity', 'Published', '']}
        loading={loading}
        empty=""
        colSpan={6}
        footer={
          <AdminLoadMore
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={() => void loadMore()}
          />
        }
      >
        {items.length === 0 && !loading ? (
          <AdminEmptyRow colSpan={6} message="No shivirs match this filter." />
        ) : (
          items.map((s) => (
            <tr key={s.id} className="hover:bg-muted/30">
              <td className="px-4 py-3 font-medium">
                <Link
                  href={`/admin/shivirs/${s.id}`}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {s.name_en}
                </Link>
                <div className="flex gap-2 text-xs text-muted-foreground">
                  {s.name_hi ? <span>{s.name_hi}</span> : null}
                  {s.msv_only ? <span className="text-amber-700">MSV only</span> : null}
                  <span className="capitalize">{s.attendance_mode.replace('_', ' ')}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {fmtDate(s.start_date)} – {fmtDate(s.end_date)}
              </td>
              <td className="px-4 py-3">{s.city_name}</td>
              <td className="px-4 py-3">{s.capacity ?? '—'}</td>
              <td className="px-4 py-3">{s.is_published ? 'Yes' : 'Draft'}</td>
              <td className="px-4 py-3">
                {canAuthor ? (
                  <div className="flex justify-end gap-2">
                    <ShivirDialog
                      existing={s}
                      onSaved={reload}
                      trigger={
                        <Button size="sm" variant="outline">
                          <Pencil className="mr-1 h-3 w-3" />
                          Edit
                        </Button>
                      }
                    />
                    <Button size="sm" variant="outline" onClick={() => void togglePublish(s)}>
                      {s.is_published ? 'Unpublish' : 'Publish'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void cancelShivir(s)}>
                      Cancel
                    </Button>
                  </div>
                ) : null}
              </td>
            </tr>
          ))
        )}
      </AdminTable>
    </AdminPageShell>
  );
}
