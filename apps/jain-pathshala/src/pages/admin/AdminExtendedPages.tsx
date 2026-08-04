import { useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AdminEmptyRow,
  AdminError,
  AdminPageShell,
  AdminTable,
} from '@/components/admin/AdminPageShell';
import { useAdminList } from '@/hooks/useAdminList';
import { apiGet, apiPost, del, ApiError } from '@/lib/api-client';
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

/* ——— Curriculum authoring ———
 * The parent curriculum shell is created via AddCurriculumDialog
 * (POST /v1/admin/curricula). Section + item CRUD lives in the dedicated
 * /v1/curriculum router. The api-client exports no PATCH helper, so this local
 * apiPatch mirrors apiPost's envelope + ApiError surface for in-place edits.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let env: { code?: string; message?: string; details?: unknown } | undefined;
    try { env = ((await res.json()) as { error?: typeof env }).error; } catch { /* noop */ }
    throw new ApiError(env?.code ?? 'ERR_HTTP', env?.message ?? res.statusText, res.status, env?.details);
  }
  if (res.status === 204) return undefined as unknown as T;
  const data = (await res.json()) as { data?: T } | T;
  return data && typeof data === 'object' && 'data' in (data as object)
    ? (data as { data: T }).data
    : (data as T);
}

interface CurriculumTreeItem { id: string; title_en: string; title_hi: string; order_index: number; }
interface CurriculumTreeSection { id: string; title_en: string; title_hi: string; order_index: number; items: CurriculumTreeItem[]; }
interface CurriculumTree {
  curriculum: { id: string; name: string; kind: string };
  sections: CurriculumTreeSection[];
}

/* Add or edit a section. */
function SectionDialog({
  curriculumId, section, onSaved, trigger,
}: {
  curriculumId: string;
  section?: CurriculumTreeItem;
  onSaved: () => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [en, setEn] = useState(section?.title_en ?? '');
  const [hi, setHi] = useState(section?.title_hi ?? '');

  useEffect(() => {
    if (open) { setEn(section?.title_en ?? ''); setHi(section?.title_hi ?? ''); }
  }, [open, section]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!en.trim() || !hi.trim()) return;
    setBusy(true);
    try {
      if (section) {
        await apiPatch(`/v1/curriculum/sections/${section.id}`, { title_en: en.trim(), title_hi: hi.trim() });
        toast.success('Section updated.');
      } else {
        await apiPost(`/v1/curriculum/${curriculumId}/sections`, { title_en: en.trim(), title_hi: hi.trim() });
        toast.success('Section added.');
      }
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error('Failed.', err instanceof ApiError ? err.message : undefined);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{section ? 'Edit section' : 'Add section'}</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Title (English) *"><Input value={en} onChange={(e) => setEn(e.target.value)} required /></FormRow>
          <FormRow label="Title (Hindi) *"><Input value={hi} onChange={(e) => setHi(e.target.value)} required /></FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !en.trim() || !hi.trim()}>{busy ? 'Saving…' : section ? 'Save' : 'Add'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* Add or edit an item. */
function ItemDialog({
  sectionId, item, onSaved, trigger,
}: {
  sectionId: string;
  item?: CurriculumTreeItem;
  onSaved: () => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [en, setEn] = useState(item?.title_en ?? '');
  const [hi, setHi] = useState(item?.title_hi ?? '');

  useEffect(() => {
    if (open) { setEn(item?.title_en ?? ''); setHi(item?.title_hi ?? ''); }
  }, [open, item]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!en.trim() || !hi.trim()) return;
    setBusy(true);
    try {
      if (item) {
        await apiPatch(`/v1/curriculum/items/${item.id}`, { title_en: en.trim(), title_hi: hi.trim() });
        toast.success('Item updated.');
      } else {
        await apiPost(`/v1/curriculum/sections/${sectionId}/items`, { title_en: en.trim(), title_hi: hi.trim() });
        toast.success('Item added.');
      }
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error('Failed.', err instanceof ApiError ? err.message : undefined);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{item ? 'Edit item' : 'Add item'}</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Title (English) *"><Input value={en} onChange={(e) => setEn(e.target.value)} required /></FormRow>
          <FormRow label="Title (Hindi) *"><Input value={hi} onChange={(e) => setHi(e.target.value)} required /></FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !en.trim() || !hi.trim()}>{busy ? 'Saving…' : item ? 'Save' : 'Add'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CurriculumTreeEditor({ tree, reloadTree }: { tree: CurriculumTree; reloadTree: () => void }) {
  const [busy, setBusy] = useState(false);

  async function deleteSection(id: string) {
    if (busy || !window.confirm('Delete this section and all its items?')) return;
    setBusy(true);
    try { await del(`/v1/curriculum/sections/${id}`); toast.success('Section deleted.'); reloadTree(); }
    catch (err) { toast.error('Failed to delete section.', err instanceof ApiError ? err.message : undefined); }
    finally { setBusy(false); }
  }
  async function deleteItem(id: string) {
    if (busy || !window.confirm('Delete this item?')) return;
    setBusy(true);
    try { await del(`/v1/curriculum/items/${id}`); toast.success('Item deleted.'); reloadTree(); }
    catch (err) { toast.error('Failed to delete item.', err instanceof ApiError ? err.message : undefined); }
    finally { setBusy(false); }
  }
  // Move by swapping adjacent ids, then submit the full ordered list.
  async function moveSection(index: number, dir: -1 | 1) {
    const ids = tree.sections.map((s) => s.id);
    const j = index + dir;
    if (busy || j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setBusy(true);
    try { await apiPost(`/v1/curriculum/${tree.curriculum.id}/sections/reorder`, { section_ids: ids }); reloadTree(); }
    catch (err) { toast.error('Failed to reorder.', err instanceof ApiError ? err.message : undefined); }
    finally { setBusy(false); }
  }
  async function moveItem(section: CurriculumTreeSection, index: number, dir: -1 | 1) {
    const ids = section.items.map((i) => i.id);
    const j = index + dir;
    if (busy || j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setBusy(true);
    try { await apiPost(`/v1/curriculum/sections/${section.id}/items/reorder`, { item_ids: ids }); reloadTree(); }
    catch (err) { toast.error('Failed to reorder.', err instanceof ApiError ? err.message : undefined); }
    finally { setBusy(false); }
  }

  return (
    <Card className="space-y-5 p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg text-secondary">
          {tree.curriculum.name}{' '}
          <Badge variant="secondary" className="ml-2 uppercase">{tree.curriculum.kind}</Badge>
        </h3>
        <SectionDialog
          curriculumId={tree.curriculum.id}
          onSaved={reloadTree}
          trigger={<Button size="sm"><Plus className="mr-1 h-4 w-4" />Add section</Button>}
        />
      </div>

      {tree.sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sections yet. Add the first section to start building this curriculum.</p>
      ) : (
        tree.sections.map((s, si) => (
          <div key={s.id} className="rounded-md border border-border/60">
            <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" disabled={busy || si === 0} onClick={() => moveSection(si, -1)} aria-label="Move section up"><ChevronUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" disabled={busy || si === tree.sections.length - 1} onClick={() => moveSection(si, 1)} aria-label="Move section down"><ChevronDown className="h-4 w-4" /></Button>
                <span className="text-sm font-semibold">{s.title_en}</span>
                <span className="text-xs text-muted-foreground">{s.title_hi}</span>
              </div>
              <div className="flex items-center gap-1">
                <SectionDialog
                  curriculumId={tree.curriculum.id}
                  section={s}
                  onSaved={reloadTree}
                  trigger={<Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Edit section"><Pencil className="h-4 w-4" /></Button>}
                />
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" disabled={busy} onClick={() => deleteSection(s.id)} aria-label="Delete section"><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            <ul className="divide-y divide-border/40">
              {s.items.length === 0 ? (
                <li className="px-3 py-2 text-xs italic text-muted-foreground">No items in this section.</li>
              ) : (
                s.items.map((it, ii) => (
                  <li key={it.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-6 w-6" disabled={busy || ii === 0} onClick={() => moveItem(s, ii, -1)} aria-label="Move item up"><ChevronUp className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" disabled={busy || ii === s.items.length - 1} onClick={() => moveItem(s, ii, 1)} aria-label="Move item down"><ChevronDown className="h-3.5 w-3.5" /></Button>
                      <span className="text-sm">{it.title_en}</span>
                      <span className="text-xs text-muted-foreground">{it.title_hi}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <ItemDialog
                        sectionId={s.id}
                        item={it}
                        onSaved={reloadTree}
                        trigger={<Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Edit item"><Pencil className="h-3.5 w-3.5" /></Button>}
                      />
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" disabled={busy} onClick={() => deleteItem(it.id)} aria-label="Delete item"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </li>
                ))
              )}
            </ul>
            <div className="border-t border-border/40 px-3 py-2">
              <ItemDialog
                sectionId={s.id}
                onSaved={reloadTree}
                trigger={<Button size="sm" variant="outline"><Plus className="mr-1 h-4 w-4" />Add item</Button>}
              />
            </div>
          </div>
        ))
      )}
    </Card>
  );
}

export function CurriculumPage() {
  const { items, loading, error, reload } = useAdminList<CurriculumRow>('/v1/admin/curricula');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tree, setTree] = useState<CurriculumTree | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);

  async function loadTree(id: string) {
    setSelectedId(id);
    setTreeLoading(true);
    setTreeError(null);
    try {
      const data = await apiGet<CurriculumTree>(`/v1/admin/curricula/${id}/tree`);
      setTree(data);
    } catch (err) {
      setTree(null);
      setTreeError(err instanceof ApiError ? err.message : 'Could not load curriculum tree.');
    } finally {
      setTreeLoading(false);
    }
  }

  function reloadTree() {
    if (selectedId) void loadTree(selectedId);
    // Keep the list section counts fresh after structural edits.
    reload();
  }

  return (
    <AdminPageShell title="Curriculum" subtitle="Build and order lesson sections and items by city." actions={<AddCurriculumDialog onAdded={reload} />}>
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
          <tr key={c.id} className={`hover:bg-muted/30 ${selectedId === c.id ? 'bg-muted/40' : ''}`}>
            <td className="px-4 py-3 font-medium">{c.name}</td>
            <td className="px-4 py-3 text-xs uppercase">{c.kind}</td>
            <td className="px-4 py-3 text-xs">{c.academic_year ?? '—'}</td>
            <td className="px-4 py-3 text-xs">{c.city_name ?? '—'}</td>
            <td className="px-4 py-3">{c.section_count}</td>
            <td className="px-4 py-3">
              <Button size="sm" variant={selectedId === c.id ? 'default' : 'outline'} onClick={() => loadTree(c.id)}>
                {selectedId === c.id ? 'Editing' : 'Edit'}
              </Button>
            </td>
          </tr>
        ))}
      </AdminTable>

      {treeError ? <AdminError message={treeError} /> : null}
      {treeLoading && !tree ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading curriculum…</Card>
      ) : tree ? (
        <CurriculumTreeEditor tree={tree} reloadTree={reloadTree} />
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
  /** Present only for city_admin+; shikshak/sanchalak get requires_otp instead. */
  exam_otp?: string | null;
  requires_otp?: boolean;
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
      toast.success(res.exam_otp ? `Exam created. OTP: ${res.exam_otp}` : 'Exam created.');
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
            <td className="px-4 py-3 font-mono text-xs">
              {e.exam_otp
                ? e.exam_otp
                : e.requires_otp
                  ? 'Set'
                  : '—'}
            </td>
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
