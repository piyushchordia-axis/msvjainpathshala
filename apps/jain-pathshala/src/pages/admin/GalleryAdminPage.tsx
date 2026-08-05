import { useState } from 'react';
import { ImagePlus, Trash2, Star, Eye, EyeOff } from 'lucide-react';
import { apiPost, del, ApiError } from '@/lib/api-client';
import { useAdminList } from '@/hooks/useAdminList';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminError, AdminLoadMore } from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

interface AdminGalleryItem {
  id: string;
  student_id: string | null;
  first_name: string;
  age_group: string;
  centre_name: string | null;
  niyam_title_en: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  caption: string | null;
  caption_hi: string | null;
  is_featured: boolean;
  is_public: boolean;
  consent_opt_in: boolean | null;
  created_at: string;
}

interface AdminStudentRow {
  id: string;
  full_name: string | null;
  student_code: string;
}

interface UploadResult {
  key: string;
  url: string;
  content_type: string;
  size: number;
}

/** Multipart upload to /v1/uploads (folder=gallery). Cookie-authed like the rest of the app. */
async function uploadGalleryFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('folder', 'gallery');
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

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

export default function GalleryAdminPage() {
  const { items, loading, loadingMore, error, reload, hasMore, loadMore } =
    useAdminList<AdminGalleryItem>('/v1/gallery/admin?limit=200');
  const { items: students } = useAdminList<AdminStudentRow>('/v1/admin/students?limit=500');

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [captionHi, setCaptionHi] = useState('');
  const [studentId, setStudentId] = useState<string>('none');
  const [makePublic, setMakePublic] = useState(true);
  const [makeFeatured, setMakeFeatured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  function onPick(f: File | null) {
    setFile(f);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  function resetForm() {
    onPick(null);
    setCaption('');
    setCaptionHi('');
    setStudentId('none');
    setMakePublic(true);
    setMakeFeatured(false);
  }

  async function create() {
    if (!file) {
      toast.error('Choose an image first.');
      return;
    }
    setBusy(true);
    try {
      const uploaded = await uploadGalleryFile(file);
      await apiPost('/v1/gallery/admin', {
        image_url: uploaded.url,
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        ...(captionHi.trim() ? { caption_hi: captionHi.trim() } : {}),
        ...(studentId !== 'none' ? { student_id: studentId } : {}),
        is_public: makePublic,
      });
      toast.success('Gallery item published.');
      resetForm();
      void reload();
    } catch (err) {
      toast.error('Could not publish.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function patchVisibility(item: AdminGalleryItem, isPublic: boolean) {
    setRowBusy(item.id);
    try {
      const res = await fetch(`${API_BASE}/v1/gallery/admin/${item.id}/visibility`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: isPublic }),
      });
      if (!res.ok) throw new Error('patch');
      void reload();
    } catch {
      toast.error('Could not update item.');
    } finally {
      setRowBusy(null);
    }
  }

  async function patchFeatured(item: AdminGalleryItem, featuredGallery: boolean) {
    setRowBusy(item.id);
    try {
      const res = await fetch(`${API_BASE}/v1/gallery/admin/${item.id}/featured`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ featured_gallery: featuredGallery }),
      });
      if (!res.ok) throw new Error('patch');
      void reload();
    } catch {
      toast.error('Could not update featuring.');
    } finally {
      setRowBusy(null);
    }
  }

  async function takedown(item: AdminGalleryItem) {
    if (!window.confirm('Remove this item from the gallery? This cannot be undone.')) return;
    setRowBusy(item.id);
    try {
      await del(`/v1/gallery/admin/${item.id}`);
      toast.success('Item removed.');
      void reload();
    } catch (err) {
      toast.error('Could not remove item.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <AdminPageShell
      title="Gallery"
      subtitle="Publish photos, manage visibility, and take down items. Student photos only appear publicly when the family has opted in."
    >
      {error ? <AdminError message={error} /> : null}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* Upload form */}
        <Card className="space-y-4 p-5">
          <div className="text-sm font-semibold">Add a photo</div>

          <FormRow label="Image">
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
          </FormRow>

          {preview ? (
            <img src={preview} alt="Preview" className="aspect-[4/3] w-full rounded-md border object-cover" />
          ) : (
            <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
              No image selected
            </div>
          )}

          <FormRow label="Caption (English)">
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Optional caption…"
              rows={2}
            />
          </FormRow>

          <FormRow label="Caption (Hindi)">
            <Textarea
              value={captionHi}
              onChange={(e) => setCaptionHi(e.target.value)}
              placeholder="वैकल्पिक…"
              rows={2}
            />
          </FormRow>

          <FormRow label="Attach to student (optional)">
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger>
                <SelectValue placeholder="No student (general photo)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No student (general photo)</SelectItem>
                {students.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.full_name ?? s.student_code} ({s.student_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>

          {studentId !== 'none' ? (
            <p className="text-xs text-muted-foreground">
              Will only appear publicly if this student&apos;s family has opted in to gallery visibility.
            </p>
          ) : null}

          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={makePublic} onChange={(e) => setMakePublic(e.target.checked)} />
              Public
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={makeFeatured} onChange={(e) => setMakeFeatured(e.target.checked)} />
              Featured
            </label>
          </div>

          <Button onClick={create} disabled={busy || !file} className="w-full">
            <ImagePlus className="mr-1 h-4 w-4" />
            {busy ? 'Publishing…' : 'Publish'}
          </Button>
        </Card>

        {/* Grid of items */}
        <div>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : items.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">No gallery items yet.</Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((g) => {
                const src = g.thumbnail_url;
                const consentPending = g.student_id && g.consent_opt_in === false;
                return (
                  <Card key={g.id} className="overflow-hidden p-0">
                    <div className="relative aspect-[4/3] bg-muted">
                      {src ? (
                        <img
                          src={src}
                          alt={g.caption ?? g.first_name ?? ''}
                          width={400}
                          height={300}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-muted-foreground">
                          {(g.first_name ?? 'G').slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      {!g.is_public ? (
                        <span className="absolute left-2 top-2 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
                          Hidden
                        </span>
                      ) : null}
                      {g.is_featured ? (
                        <span className="absolute right-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">
                          Featured
                        </span>
                      ) : null}
                    </div>
                    <div className="space-y-2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {g.first_name || 'General photo'}
                        </span>
                        {g.centre_name ? (
                          <span className="shrink-0 text-xs text-muted-foreground">{g.centre_name}</span>
                        ) : null}
                      </div>
                      {g.caption ? (
                        <p className="line-clamp-2 text-xs text-muted-foreground">{g.caption}</p>
                      ) : null}
                      {consentPending ? (
                        <p className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-700">
                          Consent pending — not shown publicly until the family opts in.
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rowBusy === g.id}
                          onClick={() => patchVisibility(g, !g.is_public)}
                        >
                          {g.is_public ? <EyeOff className="mr-1 h-3.5 w-3.5" /> : <Eye className="mr-1 h-3.5 w-3.5" />}
                          {g.is_public ? 'Hide' : 'Show'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rowBusy === g.id}
                          onClick={() => patchFeatured(g, !g.is_featured)}
                        >
                          <Star className="mr-1 h-3.5 w-3.5" />
                          {g.is_featured ? 'Unfeature' : 'Feature'}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={rowBusy === g.id}
                          onClick={() => takedown(g)}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
          <AdminLoadMore
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={() => void loadMore()}
          />
        </div>
      </div>
    </AdminPageShell>
  );
}
