import { useState } from 'react';
import { Plus, Trash2, Pencil, ExternalLink } from 'lucide-react';
import { apiGet, apiPost, del, ApiError } from '@/lib/api-client';
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
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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
  DialogClose,
} from '@/components/ui/dialog';
import { safeHref } from '@/lib/safe-url';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

const CONTENT_TYPES = ['pdf', 'video', 'audio', 'image'] as const;
const ACCESS_TIERS = ['public', 'student', 'msv', 'shikshak'] as const;
type ContentType = (typeof CONTENT_TYPES)[number];
type AccessTier = (typeof ACCESS_TIERS)[number];

// Mirrors GET /v1/library/admin row shape.
interface LibraryRow {
  id: string;
  content_type: ContentType;
  title_en: string;
  title_hi: string | null;
  description_en: string | null;
  description_hi: string | null;
  embed_url: string | null;
  file_url: string | null;
  url: string | null;
  access_tier: AccessTier;
  is_published: boolean;
  access_count: number;
  created_at: string;
}

interface UploadResult {
  key: string;
  url: string;
  content_type: string;
  size: number;
}

const TIER_LABEL: Record<AccessTier, string> = {
  public: 'Public',
  student: 'Members',
  msv: 'MSV',
  shikshak: 'Teachers',
};

const TIER_TONE: Record<AccessTier, 'secondary' | 'default' | 'outline'> = {
  public: 'secondary',
  student: 'default',
  msv: 'default',
  shikshak: 'outline',
};

/** Multipart upload to /v1/uploads (folder=library). Cookie-authed like the rest of the app. */
async function uploadLibraryFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('folder', 'library');
  const res = await fetch(`${API_BASE}/v1/uploads`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    body: form,
  });
  if (!res.ok) {
    let code = 'ERR_UPLOAD';
    let message = res.statusText;
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(code, message, res.status);
  }
  const json = (await res.json()) as { data: UploadResult };
  return json.data;
}

/** PATCH /v1/library/:id (cookie-authed). apiPost only does POST, so go raw. */
async function patchLibrary(id: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/library/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let code = 'ERR_HTTP';
    let message = res.statusText;
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(code, message, res.status);
  }
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

interface ItemFormValues {
  content_type: ContentType;
  title_en: string;
  title_hi: string;
  description_en: string;
  description_hi: string;
  embed_url: string;
  file_url: string;
  access_tier: AccessTier;
  is_published: boolean;
}

const EMPTY_FORM: ItemFormValues = {
  content_type: 'pdf',
  title_en: '',
  title_hi: '',
  description_en: '',
  description_hi: '',
  embed_url: '',
  file_url: '',
  access_tier: 'public',
  is_published: true,
};

function ItemDialog({
  mode,
  initial,
  trigger,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial: { id?: string } & ItemFormValues;
  trigger: React.ReactNode;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<ItemFormValues>(initial);

  function set<K extends keyof ItemFormValues>(key: K, value: ItemFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) setForm(initial); // refresh from the latest row on open
  }

  async function onPickFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadLibraryFile(file);
      set('file_url', uploaded.url);
      toast.success('File uploaded.');
    } catch (err) {
      toast.error('Upload failed.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!form.title_en.trim()) {
      toast.error('A title is required.');
      return;
    }
    if (!form.embed_url.trim() && !form.file_url.trim()) {
      toast.error('Provide an embed link or upload a file so the item is deliverable.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        content_type: form.content_type,
        title_en: form.title_en.trim(),
        ...(form.title_hi.trim() ? { title_hi: form.title_hi.trim() } : {}),
        ...(form.description_en.trim() ? { description_en: form.description_en.trim() } : {}),
        ...(form.description_hi.trim() ? { description_hi: form.description_hi.trim() } : {}),
        access_tier: form.access_tier,
        is_published: form.is_published,
      };

      if (mode === 'create') {
        await apiPost('/v1/library', {
          ...payload,
          ...(form.embed_url.trim() ? { embed_url: form.embed_url.trim() } : {}),
          ...(form.file_url.trim() ? { file_url: form.file_url.trim() } : {}),
        });
        toast.success('Library item created.');
      } else if (initial.id) {
        // On edit, send the URL fields explicitly (null to clear) so the server
        // can validate the item stays deliverable.
        await patchLibrary(initial.id, {
          ...payload,
          embed_url: form.embed_url.trim() || null,
          file_url: form.file_url.trim() || null,
        });
        toast.success('Library item updated.');
      }
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error('Could not save item.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add library item' : 'Edit library item'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Content type *">
              <Select value={form.content_type} onValueChange={(v) => set('content_type', v as ContentType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="uppercase">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>
            <FormRow label="Access tier *">
              <Select value={form.access_tier} onValueChange={(v) => set('access_tier', v as AccessTier)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCESS_TIERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIER_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Title (English) *">
              <Input value={form.title_en} onChange={(e) => set('title_en', e.target.value)} required />
            </FormRow>
            <FormRow label="Title (Hindi)">
              <Input value={form.title_hi} onChange={(e) => set('title_hi', e.target.value)} />
            </FormRow>
          </div>
          <FormRow label="Description (English)">
            <Textarea
              value={form.description_en}
              onChange={(e) => set('description_en', e.target.value)}
              rows={2}
            />
          </FormRow>
          <FormRow label="Description (Hindi)">
            <Textarea
              value={form.description_hi}
              onChange={(e) => set('description_hi', e.target.value)}
              rows={2}
            />
          </FormRow>
          <FormRow label="Embed / external link (for hosted video, audio or pages)">
            <Input
              value={form.embed_url}
              onChange={(e) => set('embed_url', e.target.value)}
              placeholder="https://…"
            />
          </FormRow>
          <FormRow label="Upload a file (PDF, audio, image)">
            <Input
              type="file"
              accept="application/pdf,audio/mpeg,audio/mp4,audio/aac,image/png,image/jpeg,image/webp"
              disabled={uploading}
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
            {form.file_url ? (
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate">Uploaded.</span>
                {safeHref(form.file_url) ? (
                  <a
                    href={safeHref(form.file_url)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> View
                  </a>
                ) : null}
                <button
                  type="button"
                  className="text-destructive hover:underline"
                  onClick={() => set('file_url', '')}
                >
                  Remove
                </button>
              </div>
            ) : uploading ? (
              <div className="mt-1 text-xs text-muted-foreground">Uploading…</div>
            ) : null}
          </FormRow>
          <label className="flex items-center justify-between gap-2 text-sm">
            <span>Published</span>
            <Switch checked={form.is_published} onCheckedChange={(v) => set('is_published', v)} />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || uploading}>
              {busy ? 'Saving…' : mode === 'create' ? 'Create' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteButton({ row, onDeleted }: { row: LibraryRow; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!window.confirm(`Delete “${row.title_en}”? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await del(`/v1/library/${row.id}`);
      toast.success('Library item deleted.');
      onDeleted();
    } catch (err) {
      toast.error('Could not delete item.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size="sm" variant="ghost" onClick={remove} disabled={busy} aria-label="Delete">
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
}

export default function LibraryAdminPage() {
  const { user } = useAuth();
  const { items, loading, loadingMore, error, reload, hasMore, loadMore } = useAdminList<LibraryRow>(
    '/v1/library/admin?limit=200',
  );
  // Network-wide table — same gate as isLibraryEditor / can_edit on GET /v1/library/admin.
  // Role (not items.length) so an empty list still shows "New" for super_admin only.
  const canEdit = user?.role === 'super_admin';
  const columns = canEdit
    ? ['Title', 'Type', 'Access', 'Delivery', 'Members', 'Published', 'Actions']
    : ['Title', 'Type', 'Access', 'Delivery', 'Members', 'Published'];
  const colSpan = columns.length;

  return (
    <AdminPageShell
      title="Library"
      subtitle="Network-wide learning resources — videos, audio, PDFs and images, tiered by membership."
      actions={
        canEdit ? (
          <ItemDialog
            mode="create"
            initial={{ ...EMPTY_FORM }}
            onSaved={reload}
            trigger={
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" />
                New resource
              </Button>
            }
          />
        ) : undefined
      }
    >
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={columns}
        loading={loading}
        empty=""
        colSpan={colSpan}
        footer={
          <AdminLoadMore hasMore={hasMore} loadingMore={loadingMore} onLoadMore={() => void loadMore()} />
        }
      >
        {items.length === 0 && !loading ? (
          <AdminEmptyRow colSpan={colSpan} message="No library items yet." />
        ) : null}
        {items.map((l) => (
          <tr key={l.id} className="hover:bg-muted/30">
            <td className="px-4 py-3">
              <div className="font-medium">{l.title_en}</div>
              {l.title_hi ? <div className="text-xs text-muted-foreground">{l.title_hi}</div> : null}
            </td>
            <td className="px-4 py-3 text-xs uppercase">{l.content_type}</td>
            <td className="px-4 py-3">
              <Badge variant={TIER_TONE[l.access_tier]}>{TIER_LABEL[l.access_tier]}</Badge>
            </td>
            <td className="px-4 py-3 text-xs">
              {safeHref(l.url) ? (
                <a
                  href={safeHref(l.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {l.file_url ? 'File' : 'Link'}
                </a>
              ) : (
                <span className="text-destructive">Missing</span>
              )}
            </td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{l.access_count}</td>
            <td className="px-4 py-3 text-xs">{l.is_published ? 'Yes' : 'Draft'}</td>
            {canEdit ? (
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
                  <ItemDialog
                    mode="edit"
                    initial={{
                      id: l.id,
                      content_type: l.content_type,
                      title_en: l.title_en,
                      title_hi: l.title_hi ?? '',
                      description_en: l.description_en ?? '',
                      description_hi: l.description_hi ?? '',
                      embed_url: l.embed_url ?? '',
                      file_url: l.file_url ?? '',
                      access_tier: l.access_tier,
                      is_published: l.is_published,
                    }}
                    onSaved={reload}
                    trigger={
                      <Button size="sm" variant="ghost" aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <DeleteButton row={l} onDeleted={reload} />
                </div>
              </td>
            ) : null}
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}
