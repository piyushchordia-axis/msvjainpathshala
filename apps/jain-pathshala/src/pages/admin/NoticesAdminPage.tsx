import { useEffect, useState } from 'react';
import { Plus, Megaphone, Pencil, Trash2, Loader2 } from 'lucide-react';
import { apiGet, apiPost, del, ApiError } from '@/lib/api-client';
import { useAdminList } from '@/hooks/useAdminList';
import { useAuth } from '@/lib/auth-context';
import { useScopedGeography } from '@/hooks/useScopedGeography';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminTable, AdminError, AdminEmptyRow, AdminLoadMore } from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const MACHINE_TRANSLATION_HINT = 'Machine translation — please check before publishing.';

type Audience = 'batch' | 'centre' | 'city' | 'state' | 'national' | 'msv';

interface NoticeRow {
  id: string;
  title_en: string;
  title_hi: string | null;
  content_en: string | null;
  content_hi: string | null;
  audience: Audience;
  state_id: string | null;
  city_id: string | null;
  centre_id: string | null;
  batch_id: string | null;
  centre_name: string | null;
  batch_name: string | null;
  is_public: boolean;
  pinned: boolean;
  is_critical: boolean;
  published_at: string | null;
  expires_at: string | null;
  is_expired: boolean;
  created_at: string;
}

interface CentreOption { id: string; name: string; city_name: string; state_name: string; }
interface BatchOption { id: string; name: string; centre_name: string; }
interface StateOption { id: string; name: string; }
interface CityOption { id: string; name: string; state_id: string; state_name: string; }

const AUDIENCE_LABEL: Record<Audience, string> = {
  national: 'National',
  state: 'State',
  city: 'City',
  centre: 'Centre',
  batch: 'Batch',
  msv: 'MSV members',
};

/**
 * Audiences a role can actually publish to (SAN-API-02): the dialog offered
 * everything and defaulted to National, so a sanchalak composed a full notice
 * and only then got a 403.
 */
function audiencesForRole(role: string | undefined): Audience[] {
  if (role === 'super_admin') return ['national', 'state', 'city', 'centre', 'batch', 'msv'];
  if (role === 'state_admin') return ['state', 'city', 'centre', 'batch', 'msv'];
  if (role === 'city_admin') return ['city', 'centre', 'batch', 'msv'];
  // sanchalak / shikshak publish to their centre or a batch.
  return ['centre', 'batch'];
}

function defaultAudienceForRole(role: string | undefined): Audience {
  const allowed = audiencesForRole(role);
  return allowed.includes('national') ? 'national' : allowed[0]!;
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs font-medium">{label}</Label>{children}</div>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB');
}

/** ISO → YYYY-MM-DD for `<input type="date">` in Asia/Kolkata. */
function isoToEndsOn(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** YYYY-MM-DD → end-of-day IST ISO for expires_at. */
function endsOnToIso(date: string): string | null {
  const trimmed = date.trim();
  if (!trimmed) return null;
  const d = new Date(`${trimmed}T23:59:59.999+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

interface FormState {
  title_en: string;
  title_hi: string;
  content_en: string;
  content_hi: string;
  audience: Audience;
  state_id: string;
  city_id: string;
  centre_id: string;
  batch_id: string;
  is_public: boolean;
  pinned: boolean;
  is_critical: boolean;
  ends_on: string;
}

function emptyForm(audience: Audience = 'national'): FormState {
  return {
    title_en: '', title_hi: '', content_en: '', content_hi: '',
    audience, state_id: '', city_id: '', centre_id: '', batch_id: '',
    is_public: true, pinned: false, is_critical: false, ends_on: '',
  };
}

function formFromRow(n: NoticeRow): FormState {
  return {
    title_en: n.title_en ?? '',
    title_hi: n.title_hi ?? '',
    content_en: n.content_en ?? '',
    content_hi: n.content_hi ?? '',
    audience: n.audience,
    state_id: n.state_id ?? '',
    city_id: n.city_id ?? '',
    centre_id: n.centre_id ?? '',
    batch_id: n.batch_id ?? '',
    is_public: n.is_public,
    pinned: n.pinned,
    is_critical: n.is_critical,
    ends_on: isoToEndsOn(n.expires_at),
  };
}

/** Build the request body, sending only the scope column the audience needs. */
function toBody(f: FormState) {
  return {
    title_en: f.title_en.trim(),
    title_hi: f.title_hi.trim() || undefined,
    content_en: f.content_en.trim() || undefined,
    content_hi: f.content_hi.trim() || undefined,
    audience: f.audience,
    state_id: f.audience === 'state' ? f.state_id || undefined : undefined,
    city_id: f.audience === 'city' ? f.city_id || undefined : undefined,
    centre_id: f.audience === 'centre' ? f.centre_id || undefined : undefined,
    batch_id: f.audience === 'batch' ? f.batch_id || undefined : undefined,
    is_public: f.is_public,
    pinned: f.pinned,
    is_critical: f.is_critical,
    expires_at: endsOnToIso(f.ends_on),
  };
}

function targetValid(f: FormState): boolean {
  if (f.audience === 'state') return !!f.state_id;
  if (f.audience === 'city') return !!f.city_id;
  if (f.audience === 'centre') return !!f.centre_id;
  if (f.audience === 'batch') return !!f.batch_id;
  return true;
}

function NoticeForm({
  mode, initial, onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: NoticeRow;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const allowedAudiences = audiencesForRole(user?.role);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(
    initial ? formFromRow(initial) : emptyForm(defaultAudienceForRole(user?.role)),
  );
  const [translateAvailable, setTranslateAvailable] = useState(false);
  const [translating, setTranslating] = useState<'title' | 'content' | null>(null);
  const [titleHiSuggested, setTitleHiSuggested] = useState(false);
  const [contentHiSuggested, setContentHiSuggested] = useState(false);

  // Targeting option sources, loaded lazily when the dialog opens.
  const [centres, setCentres] = useState<CentreOption[]>([]);
  const [batches, setBatches] = useState<BatchOption[]>([]);
  // Scope-filtered + cached — the raw national list offered every city in
  // India and re-fetched per open (CTY-API-05/PRF-01).
  const geo = useScopedGeography(open);
  const states = geo.states;
  const cities = geo.cities;

  useEffect(() => {
    if (!open) return;
    setForm(initial ? formFromRow(initial) : emptyForm(defaultAudienceForRole(user?.role)));
    setTitleHiSuggested(false);
    setContentHiSuggested(false);
    setTranslating(null);
    void apiGet<{ items: CentreOption[] }>('/v1/admin/centres').then((r) => setCentres(r?.items ?? [])).catch(() => {});
    void apiGet<{ items: BatchOption[] }>('/v1/admin/batches').then((r) => setBatches(r?.items ?? [])).catch(() => {});
    void apiGet<{ available: boolean }>('/v1/translate')
      .then((r) => setTranslateAvailable(r?.available === true))
      .catch(() => setTranslateAvailable(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function translateField(field: 'title' | 'content') {
    const source = field === 'title' ? form.title_en.trim() : form.content_en.trim();
    if (!source || !translateAvailable || translating) return;
    setTranslating(field);
    try {
      const res = await apiPost<{ text: string }>('/v1/translate', {
        text: source,
        target: 'hi',
        context: 'notice',
      });
      const hi = res?.text?.trim() ?? '';
      if (!hi) throw new Error('Empty translation');
      if (field === 'title') {
        set('title_hi', hi);
        setTitleHiSuggested(true);
      } else {
        set('content_hi', hi);
        setContentHiSuggested(true);
      }
    } catch (err) {
      toast.error(
        'Could not translate to Hindi.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setTranslating(null);
    }
  }

  const canSubmit = form.title_en.trim().length > 0 && targetValid(form);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      if (mode === 'create') {
        await apiPost('/v1/notices/admin', toBody(form));
        toast.success('Notice published.');
      } else {
        await apiPost(`/v1/notices/admin/${initial!.id}`, toBody(form));
        toast.success('Notice updated.');
      }
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(
        mode === 'create' ? 'Failed to publish notice.' : 'Failed to update notice.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === 'create' ? (
          <Button size="sm"><Plus className="mr-1 h-4 w-4" />New notice</Button>
        ) : (
          <Button size="sm" variant="ghost"><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{mode === 'create' ? 'New notice' : 'Edit notice'}</DialogTitle></DialogHeader>
        <form className="max-h-[70vh] space-y-4 overflow-y-auto pt-2" onSubmit={submit}>
          <FormRow label="Audience *">
            <Select value={form.audience} onValueChange={(v) => set('audience', v as Audience)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {allowedAudiences.map((a) => (
                  <SelectItem key={a} value={a}>{AUDIENCE_LABEL[a]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>

          {form.audience === 'state' ? (
            <FormRow label="State *">
              <Select value={form.state_id} onValueChange={(v) => set('state_id', v)}>
                <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent>
                  {states.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormRow>
          ) : null}

          {form.audience === 'city' ? (
            <FormRow label="City *">
              <Select value={form.city_id} onValueChange={(v) => set('city_id', v)}>
                <SelectTrigger><SelectValue placeholder="Select city" /></SelectTrigger>
                <SelectContent>
                  {cities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} · {c.state_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormRow>
          ) : null}

          {form.audience === 'centre' ? (
            <FormRow label="Centre *">
              <Select value={form.centre_id} onValueChange={(v) => set('centre_id', v)}>
                <SelectTrigger><SelectValue placeholder="Select centre" /></SelectTrigger>
                <SelectContent>
                  {centres.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} · {c.city_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormRow>
          ) : null}

          {form.audience === 'batch' ? (
            <FormRow label="Batch *">
              <Select value={form.batch_id} onValueChange={(v) => set('batch_id', v)}>
                <SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger>
                <SelectContent>
                  {batches.map((b) => <SelectItem key={b.id} value={b.id}>{(b.name || 'Batch')} · {b.centre_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormRow>
          ) : null}

          <FormRow label="Title (English) *">
            <Input value={form.title_en} onChange={(e) => set('title_en', e.target.value)} placeholder="e.g. Pathshala closed on Mahavir Jayanti" required />
          </FormRow>
          <FormRow label="Title (हिन्दी)">
            <div className="flex items-start gap-2">
              <Input
                className="flex-1"
                value={form.title_hi}
                onChange={(e) => {
                  set('title_hi', e.target.value);
                  setTitleHiSuggested(false);
                }}
                placeholder="शीर्षक (वैकल्पिक)"
              />
              {translateAvailable ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={!form.title_en.trim() || translating !== null}
                  onClick={() => void translateField('title')}
                >
                  {translating === 'title' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : null}
                  Translate to Hindi
                </Button>
              ) : null}
            </div>
            {titleHiSuggested ? (
              <p className="text-xs text-muted-foreground">{MACHINE_TRANSLATION_HINT}</p>
            ) : null}
          </FormRow>
          <FormRow label="Content (English)">
            <Textarea value={form.content_en} onChange={(e) => set('content_en', e.target.value)} rows={3} placeholder="Optional details" />
          </FormRow>
          <FormRow label="Content (हिन्दी)">
            <div className="space-y-2">
              <Textarea
                value={form.content_hi}
                onChange={(e) => {
                  set('content_hi', e.target.value);
                  setContentHiSuggested(false);
                }}
                rows={3}
                placeholder="विवरण (वैकल्पिक)"
              />
              {translateAvailable ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!form.content_en.trim() || translating !== null}
                  onClick={() => void translateField('content')}
                >
                  {translating === 'content' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : null}
                  Translate to Hindi
                </Button>
              ) : null}
            </div>
            {contentHiSuggested ? (
              <p className="text-xs text-muted-foreground">{MACHINE_TRANSLATION_HINT}</p>
            ) : null}
          </FormRow>

          <div className="space-y-2 rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.is_public} onCheckedChange={(v) => set('is_public', v === true)} />
              Show on the public website &amp; guest app
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.pinned} onCheckedChange={(v) => set('pinned', v === true)} />
              Pin to the top
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.is_critical} onCheckedChange={(v) => set('is_critical', v === true)} />
              Mark as important
            </label>
          </div>

          <FormRow label="Ends on (optional)">
            <Input
              type="date"
              value={form.ends_on}
              onChange={(e) => set('ends_on', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to keep this notice up indefinitely.
            </p>
          </FormRow>

          <DialogFooter className="pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !canSubmit}>
              {busy ? 'Saving…' : mode === 'create' ? 'Publish' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteButton({ notice, onDeleted }: { notice: NoticeRow; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await del(`/v1/notices/admin/${notice.id}`);
      toast.success('Notice deleted.');
      setOpen(false);
      onDeleted();
    } catch (err) {
      toast.error('Could not delete notice.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
          <Trash2 className="mr-1 h-3.5 w-3.5" />Delete
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Delete notice?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          “{notice.title_en}” will be permanently removed. This cannot be undone.
        </p>
        <DialogFooter className="pt-2">
          <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
          <Button type="button" variant="destructive" disabled={busy} onClick={confirm}>
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AudiencePill({ n }: { n: NoticeRow }) {
  let detail = '';
  if (n.audience === 'centre') detail = n.centre_name ? ` · ${n.centre_name}` : '';
  else if (n.audience === 'batch') detail = n.batch_name ? ` · ${n.batch_name}` : '';
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {AUDIENCE_LABEL[n.audience]}{detail}
    </span>
  );
}

export default function NoticesAdminPage() {
  const { items, loading, loadingMore, error, reload, hasMore, loadMore } = useAdminList<NoticeRow>(
    '/v1/notices/admin?limit=200',
  );

  return (
    <AdminPageShell
      title="Notices"
      subtitle="Announcements targeted by audience. Public notices also appear on the website."
      actions={<NoticeForm mode="create" onSaved={reload} />}
    >
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['Notice', 'Audience', 'Visibility', 'Published', 'Actions']}
        loading={loading}
        empty=""
        colSpan={5}
        footer={
          <AdminLoadMore hasMore={hasMore} loadingMore={loadingMore} onLoadMore={() => void loadMore()} />
        }
      >
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={5} message="No notices yet." /> : null}
        {items.map((n) => (
          <tr key={n.id} className="hover:bg-muted/30 align-top">
            <td className="px-4 py-3 font-medium">
              <span className="inline-flex items-center gap-1.5">
                <Megaphone className="h-3.5 w-3.5 text-muted-foreground" />
                {n.title_en}
              </span>
              <span className="ml-2 inline-flex gap-1">
                {n.pinned ? <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Pinned</span> : null}
                {n.is_critical ? <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">Important</span> : null}
                {n.is_expired ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Expired</span> : null}
              </span>
              {n.title_hi ? <span className="block text-xs text-muted-foreground">{n.title_hi}</span> : null}
            </td>
            <td className="px-4 py-3"><AudiencePill n={n} /></td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{n.is_public ? 'Public' : 'Internal'}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(n.published_at ?? n.created_at)}</td>
            <td className="px-4 py-3">
              <div className="flex items-center gap-1">
                <NoticeForm mode="edit" initial={n} onSaved={reload} />
                <DeleteButton notice={n} onDeleted={reload} />
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}
