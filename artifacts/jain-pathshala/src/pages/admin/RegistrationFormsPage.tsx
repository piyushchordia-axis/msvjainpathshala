import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { apiPost, ApiError } from '@/lib/api-client';
import { useAdminList } from '@/hooks/useAdminList';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminTable, AdminError, AdminEmptyRow } from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const FORM_KINDS = ['student', 'parent', 'shikshak', 'sanchalak', 'city_admin'] as const;
const FIELD_TYPES = ['text', 'number', 'date', 'select', 'tel', 'email', 'textarea'] as const;

interface FieldDef {
  key: string;
  label_en: string;
  type: (typeof FIELD_TYPES)[number];
  required: boolean;
}

interface ConfigRow {
  id: string;
  city_id: string | null;
  city_name: string | null;
  form_kind: string;
  title_en: string;
  title_hi: string | null;
  is_active: boolean;
  version_no: number;
  fields: FieldDef[];
  published_at: string | null;
  created_at: string;
}

interface ResponseRow {
  id: string;
  form_kind: string;
  city_name: string | null;
  full_name: string;
  phone: string | null;
  status: 'submitted' | 'approved' | 'rejected';
  responses: Record<string, unknown>;
  review_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB');
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'approved'
      ? 'bg-emerald-500/10 text-emerald-700'
      : status === 'rejected'
        ? 'bg-destructive/10 text-destructive'
        : 'bg-muted text-muted-foreground';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${cls}`}>{status}</span>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

let fieldRowSeq = 0;

function AddConfigDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formKind, setFormKind] = useState('student');
  const [titleEn, setTitleEn] = useState('');
  const [titleHi, setTitleHi] = useState('');
  const [fields, setFields] = useState<(FieldDef & { _rid: number })[]>([
    { _rid: ++fieldRowSeq, key: '', label_en: '', type: 'text', required: true },
  ]);

  function reset() {
    setFormKind('student');
    setTitleEn('');
    setTitleHi('');
    setFields([{ _rid: ++fieldRowSeq, key: '', label_en: '', type: 'text', required: true }]);
  }

  function addField() {
    setFields((f) => [...f, { _rid: ++fieldRowSeq, key: '', label_en: '', type: 'text', required: false }]);
  }
  function removeField(rid: number) {
    setFields((f) => (f.length <= 1 ? f : f.filter((x) => x._rid !== rid)));
  }
  function patchField(rid: number, patch: Partial<FieldDef>) {
    setFields((f) => f.map((x) => (x._rid === rid ? { ...x, ...patch } : x)));
  }

  const cleanFields = fields
    .map((f) => ({ key: f.key.trim(), label_en: f.label_en.trim(), type: f.type, required: f.required }))
    .filter((f) => f.key && f.label_en);

  const canSubmit = titleEn.trim().length > 0 && cleanFields.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const res = await apiPost<{ version_no: number }>('/v1/registration/configs', {
        form_kind: formKind,
        title_en: titleEn.trim(),
        title_hi: titleHi.trim() || undefined,
        fields: cleanFields,
      });
      toast.success(`Form config published (v${res.version_no}).`);
      setOpen(false);
      reset();
      onAdded();
    } catch (err) {
      toast.error('Failed to publish form config.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />New form config</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Publish registration form</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Form kind *">
              <Select value={formKind} onValueChange={setFormKind}>
                <SelectTrigger><SelectValue placeholder="Select kind" /></SelectTrigger>
                <SelectContent>
                  {FORM_KINDS.map((k) => (
                    <SelectItem key={k} value={k} className="capitalize">{k.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>
            <FormRow label="Title (English) *">
              <Input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} required />
            </FormRow>
          </div>
          <FormRow label="Title (Hindi)">
            <Input value={titleHi} onChange={(e) => setTitleHi(e.target.value)} />
          </FormRow>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Fields *</Label>
              <Button type="button" size="sm" variant="outline" onClick={addField}>
                <Plus className="mr-1 h-3 w-3" />Add field
              </Button>
            </div>
            <div className="space-y-2">
              {fields.map((f) => (
                <div key={f._rid} className="flex items-end gap-2 rounded-md border border-border p-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Key</Label>
                    <Input
                      value={f.key}
                      onChange={(e) => patchField(f._rid, { key: e.target.value })}
                      placeholder="full_name"
                      className="h-8"
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Label (EN)</Label>
                    <Input
                      value={f.label_en}
                      onChange={(e) => patchField(f._rid, { label_en: e.target.value })}
                      placeholder="Full name"
                      className="h-8"
                    />
                  </div>
                  <div className="w-28 space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Type</Label>
                    <Select value={f.type} onValueChange={(v) => patchField(f._rid, { type: v as FieldDef['type'] })}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FIELD_TYPES.map((t) => (
                          <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center gap-1 pb-2 text-xs">
                    <Checkbox
                      checked={f.required}
                      onCheckedChange={(c) => patchField(f._rid, { required: c === true })}
                    />
                    Req
                  </label>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="mb-1 h-8 w-8"
                    onClick={() => removeField(f._rid)}
                    disabled={fields.length <= 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !canSubmit}>{busy ? 'Publishing…' : 'Publish'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReviewActions({ id, status, onChanged }: { id: string; status: string; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function act(action: 'approve' | 'reject') {
    if (busy) return;
    const note =
      action === 'reject' ? window.prompt('Reason for rejection (optional):') ?? undefined : undefined;
    setBusy(action);
    try {
      await apiPost(`/v1/registration/responses/${id}/${action}`, note ? { review_note: note } : {});
      toast.success(`Response ${action === 'approve' ? 'approved' : 'rejected'}.`);
      onChanged();
    } catch (err) {
      toast.error(`Could not ${action} response.`, err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  if (status !== 'submitted') return <span className="text-xs text-muted-foreground">Reviewed</span>;
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => act('approve')}>
        Approve
      </Button>
      <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => act('reject')}>
        Reject
      </Button>
    </div>
  );
}

export default function RegistrationFormsPage() {
  const configs = useAdminList<ConfigRow>('/v1/registration/configs?limit=100');
  const responses = useAdminList<ResponseRow>('/v1/registration/responses?limit=200');

  return (
    <AdminPageShell
      title="Registration forms"
      subtitle="Dynamic public registration forms and their submitted responses."
      actions={<AddConfigDialog onAdded={configs.reload} />}
    >
      <div className="space-y-8">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-secondary">Form configs</h3>
          {configs.error ? <AdminError message={configs.error} /> : null}
          <AdminTable
            columns={['Kind', 'Title', 'Scope', 'Version', 'Fields', 'Active', 'Published']}
            loading={configs.loading}
            empty=""
            colSpan={7}
          >
            {configs.items.length === 0 && !configs.loading ? (
              <AdminEmptyRow colSpan={7} message="No form configs yet." />
            ) : null}
            {configs.items.map((c) => (
              <tr key={c.id} className="hover:bg-muted/30">
                <td className="px-4 py-3 text-xs capitalize">{c.form_kind.replace('_', ' ')}</td>
                <td className="px-4 py-3 font-medium">{c.title_en}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{c.city_name ?? 'Global'}</td>
                <td className="px-4 py-3 font-mono text-xs">v{c.version_no}</td>
                <td className="px-4 py-3 text-xs">{c.fields?.length ?? 0}</td>
                <td className="px-4 py-3">{c.is_active ? 'Yes' : 'No'}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(c.published_at)}</td>
              </tr>
            ))}
          </AdminTable>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-secondary">Responses</h3>
          {responses.error ? <AdminError message={responses.error} /> : null}
          <AdminTable
            columns={['Name', 'Kind', 'Scope', 'Phone', 'Status', 'Submitted', 'Actions']}
            loading={responses.loading}
            empty=""
            colSpan={7}
          >
            {responses.items.length === 0 && !responses.loading ? (
              <AdminEmptyRow colSpan={7} message="No responses yet." />
            ) : null}
            {responses.items.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="px-4 py-3 font-medium">{r.full_name}</td>
                <td className="px-4 py-3 text-xs capitalize">{r.form_kind.replace('_', ' ')}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{r.city_name ?? 'Global'}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.phone ?? '—'}</td>
                <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(r.submitted_at)}</td>
                <td className="px-4 py-3">
                  <ReviewActions id={r.id} status={r.status} onChanged={responses.reload} />
                </td>
              </tr>
            ))}
          </AdminTable>
        </div>
      </div>
    </AdminPageShell>
  );
}
