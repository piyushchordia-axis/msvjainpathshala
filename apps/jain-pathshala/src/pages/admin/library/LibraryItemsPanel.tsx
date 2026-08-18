import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { apiDelete, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast-jp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TARJ_MAX_LEN } from "@workspace/api-zod";
import { useConfirm } from "@/components/admin/use-confirm";
import { PublishControls } from "./PublishControls";
import { RestrictedHtmlEditor } from "./RestrictedHtmlEditor";
import {
  flattenLibraryItems,
  formatBytes,
  hasUnpublishedChanges,
  type LibraryAdminItem,
  type LibraryAdminSection,
} from "./library-admin-types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

/** "4:07" — a duration an editor can compare against the recording they meant. */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

interface Props {
  sections: LibraryAdminSection[];
  canPublish: boolean;
  initialItemId?: string | null;
  onChanged: () => Promise<void>;
}

export function LibraryItemsPanel({ sections, canPublish, initialItemId, onChanged }: Props) {
  const allItems = useMemo(() => flattenLibraryItems(sections), [sections]);
  const { confirm, confirmDialog } = useConfirm();
  const [q, setQ] = useState("");
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [pubFilter, setPubFilter] = useState<"all" | "published" | "draft">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editItem, setEditItem] = useState<LibraryAdminItem | null>(() => {
    if (!initialItemId) return null;
    return allItems.find((i) => i.id === initialItemId) ?? null;
  });
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = allItems.filter((item) => {
    const hay = `${item.draft.title_en} ${item.item_code}`.toLowerCase();
    if (q && !hay.includes(q.toLowerCase())) return false;
    if (sectionFilter !== "all" && item.section_id !== sectionFilter) return false;
    if (pubFilter === "published" && !item.is_published) return false;
    if (pubFilter === "draft" && item.is_published) return false;
    return true;
  });

  async function publish(id: string, doPublish: boolean) {
    setBusyId(id);
    try {
      await apiPost(`/v1/admin/library/items/${id}/${doPublish ? "publish" : "unpublish"}`, {});
      await onChanged();
      toast.success(doPublish ? "Item published." : "Item unpublished.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Publish failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function closeEditor() {
    if (editorDirty) {
      const discard = await confirm({
        title: "Discard your changes?",
        destructive: true,
        confirmLabel: "Discard changes",
        cancelLabel: "Keep editing",
        body: <p>This item has edits you have not saved yet. Closing loses them.</p>,
      });
      if (!discard) return;
    }
    setEditorDirty(false);
    setEditItem(null);
  }

  return (
    <div className="space-y-4">
      {confirmDialog}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px] flex-1 space-y-1">
          <Label className="text-xs">Search</Label>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Title or item_code"
          />
        </div>
        <div className="w-48 space-y-1">
          <Label className="text-xs">Section</Label>
          <Select value={sectionFilter} onValueChange={setSectionFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sections</SelectItem>
              {sections.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.draft.name_en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1">
          <Label className="text-xs">Publish state</Label>
          <Select value={pubFilter} onValueChange={(v) => setPubFilter(v as typeof pubFilter)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1 h-4 w-4" />
              Add item
            </Button>
          </DialogTrigger>
          <DialogContent>
            <CreateItemForm
              sections={sections}
              onCancel={() => setCreateOpen(false)}
              onCreated={async (item) => {
                setCreateOpen(false);
                await onChanged();
                setEditItem(item);
                toast.success("Item created as draft.");
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Section</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  No items match.
                </td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr
                  key={item.id}
                  className="cursor-pointer border-t border-border hover:bg-muted/30"
                  onClick={() => setEditItem(item)}
                >
                  <td className="px-3 py-2 font-mono text-xs">{item.item_code}</td>
                  <td className="px-3 py-2">{item.draft.title_en}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {item.section_name}
                    {item.subsection_name ? ` / ${item.subsection_name}` : ""}
                  </td>
                  <td className="px-3 py-2">{item.is_published ? "Published" : "Draft"}</td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <PublishControls
                      canPublish={canPublish}
                      isPublished={item.is_published}
                      hasChanges={hasUnpublishedChanges(item)}
                      busy={busyId === item.id}
                      onPublish={() => void publish(item.id, true)}
                      onUnpublish={() => void publish(item.id, false)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog
        open={!!editItem}
        onOpenChange={(o) => {
          if (o) return;
          // Esc and a backdrop click used to discard a half-written stavan with
          // no warning — the same gesture people use to dismiss a toast.
          void closeEditor();
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          {editItem ? (
            <ItemEditor
              key={editItem.id}
              item={editItem}
              canPublish={canPublish}
              onDirtyChange={setEditorDirty}
              onRequestClose={() => void closeEditor()}
              onClose={() => {
                setEditorDirty(false);
                setEditItem(null);
              }}
              onChanged={async () => {
                await onChanged();
                const fresh = await apiGetItem(editItem.id);
                if (fresh) setEditItem(fresh);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

async function apiGetItem(id: string): Promise<LibraryAdminItem | null> {
  try {
    const res = await (await import("@/lib/api-client")).apiGet<{ item: LibraryAdminItem }>(
      `/v1/admin/library/items/${id}`,
    );
    return res.item;
  } catch {
    return null;
  }
}

function CreateItemForm({
  sections,
  onCancel,
  onCreated,
}: {
  sections: LibraryAdminSection[];
  onCancel: () => void;
  onCreated: (item: LibraryAdminItem) => Promise<void>;
}) {
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? "");
  const [subsectionId, setSubsectionId] = useState<string>("none");
  const [itemCode, setItemCode] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [titleHi, setTitleHi] = useState("");
  const [titleGu, setTitleGu] = useState("");
  const [busy, setBusy] = useState(false);

  const subs = sections.find((s) => s.id === sectionId)?.subsections ?? [];

  async function save() {
    if (!sectionId || !itemCode.trim() || !titleEn.trim()) {
      toast.error("Section, item_code, and English title are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ item: LibraryAdminItem }>("/v1/admin/library/items", {
        section_id: sectionId,
        subsection_id: subsectionId === "none" ? null : subsectionId,
        item_code: itemCode.trim(),
        title_en: titleEn.trim(),
        title_hi: titleHi.trim() || null,
        title_gu: titleGu.trim() || null,
      });
      await onCreated(res.item);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create item.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New library item</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-2">
        <FormRow label="Section">
          <Select
            value={sectionId}
            onValueChange={(v) => {
              setSectionId(v);
              setSubsectionId("none");
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sections.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.draft.name_en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormRow>
        <FormRow label="Subsection (optional)">
          <Select value={subsectionId} onValueChange={setSubsectionId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {subs.map((sub) => (
                <SelectItem key={sub.id} value={sub.id}>
                  {sub.draft.name_en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormRow>
        <FormRow label="Item code">
          <Input value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
        </FormRow>
        <FormRow label="Title (EN)">
          <Input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
        </FormRow>
        <FormRow label="Title (HI)">
          <Input
            className="field-devanagari"
            value={titleHi}
            onChange={(e) => setTitleHi(e.target.value)}
          />
        </FormRow>
        <FormRow label="Title (GU)">
          <Input value={titleGu} onChange={(e) => setTitleGu(e.target.value)} />
        </FormRow>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          Create
        </Button>
      </DialogFooter>
    </>
  );
}

function ItemEditor({
  item,
  canPublish,
  onClose,
  onChanged,
  onDirtyChange,
  onRequestClose,
}: {
  item: LibraryAdminItem;
  canPublish: boolean;
  /** Closes immediately — for after a delete, where nothing is left to keep. */
  onClose: () => void;
  onChanged: () => Promise<void>;
  /** Lets the surrounding Dialog refuse to discard unsaved edits. */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Asks to close, and may refuse. The footer button uses this; `onClose`
   * would let the most obvious way out be the one that discards silently.
   */
  onRequestClose?: () => void;
}) {
  const [lang, setLang] = useState<"en" | "hi" | "gu">("en");
  const [titleEn, setTitleEn] = useState(item.draft.title_en);
  const [titleHi, setTitleHi] = useState(item.draft.title_hi ?? "");
  const [titleGu, setTitleGu] = useState(item.draft.title_gu ?? "");
  const [textEn, setTextEn] = useState(item.draft.text_content_en ?? "");
  const [textHi, setTextHi] = useState(item.draft.text_content_hi ?? "");
  const [textGu, setTextGu] = useState(item.draft.text_content_gu ?? "");
  // §17.1.3 — plain single-line inputs, deliberately NOT RestrictedHtmlEditor:
  // a Tarj renders as one caption line, and markup pasted into it would show
  // up as tags under the title on every surface.
  const [tarjEn, setTarjEn] = useState(item.draft.tarj_en ?? "");
  const [tarjHi, setTarjHi] = useState(item.draft.tarj_hi ?? "");
  const [externalUrl, setExternalUrl] = useState(item.draft.external_url ?? "");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [youtube, setYoutube] = useState(item.draft.youtube_url ?? "");
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  // Compared against the draft the editor opened with, so saving clears it and
  // typing a character then deleting it does not leave a false warning.
  const dirty =
    titleEn !== item.draft.title_en ||
    titleHi !== (item.draft.title_hi ?? "") ||
    titleGu !== (item.draft.title_gu ?? "") ||
    textEn !== (item.draft.text_content_en ?? "") ||
    textHi !== (item.draft.text_content_hi ?? "") ||
    textGu !== (item.draft.text_content_gu ?? "") ||
    tarjEn !== (item.draft.tarj_en ?? "") ||
    tarjHi !== (item.draft.tarj_hi ?? "") ||
    externalUrl !== (item.draft.external_url ?? "") ||
    youtube !== (item.draft.youtube_url ?? "");

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  async function save() {
    setBusy(true);
    try {
      await apiPatch(`/v1/admin/library/items/${item.id}`, {
        title_en: titleEn.trim(),
        title_hi: titleHi.trim() || null,
        title_gu: titleGu.trim() || null,
        youtube_url: youtube.trim() || null,
        text_content_en: textEn || null,
        text_content_hi: textHi || null,
        text_content_gu: textGu || null,
        tarj_en: tarjEn.trim() || null,
        tarj_hi: tarjHi.trim() || null,
        external_url: externalUrl.trim() || null,
      });
      await onChanged();
      toast.success("Draft saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save item.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * §17.11.2 — PDF upload. The 413 is worth naming explicitly: multer and
   * the storage layer both fail generically, and "upload failed" tells an
   * admin holding a 140MB scan nothing about what to do next.
   */
  async function uploadPdf(file: File | null) {
    if (!file) return;
    setPdfBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/v1/admin/library/items/${item.id}/pdf`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
        body: form,
      });
      if (!res.ok) {
        let message = res.statusText;
        try {
          const j = (await res.json()) as { error?: { message?: string } };
          message = j.error?.message ?? message;
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
      await onChanged();
      toast.success("PDF uploaded to draft. Page count follows shortly.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PDF upload failed.");
    } finally {
      setPdfBusy(false);
    }
  }

  async function removePdf() {
    const ok = await confirm({
      title: "Remove the draft PDF?",
      destructive: true,
      confirmLabel: "Remove draft PDF",
      body: (
        <p>
          Readers keep seeing the currently published PDF until you publish this item again.
          You can upload a replacement at any time.
        </p>
      ),
    });
    if (!ok) return;
    setPdfBusy(true);
    try {
      await apiDelete(`/v1/admin/library/items/${item.id}/pdf`);
      await onChanged();
      toast.success("Draft PDF removed.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove the PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

  async function removeAudio() {
    const ok = await confirm({
      title: "Remove the draft audio?",
      destructive: true,
      confirmLabel: "Remove draft audio",
      body: (
        <p>
          Readers keep hearing the currently published recording until you publish this item
          again. You can upload a replacement at any time.
        </p>
      ),
    });
    if (!ok) return;
    setUploadBusy(true);
    try {
      await apiDelete(`/v1/admin/library/items/${item.id}/audio`);
      await onChanged();
      toast.success("Draft audio removed.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove the audio.");
    } finally {
      setUploadBusy(false);
    }
  }

  async function uploadAudio(file: File | null) {
    if (!file) return;
    setUploadBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/v1/admin/library/items/${item.id}/audio`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
        body: form,
      });
      if (!res.ok) {
        let message = res.statusText;
        try {
          const j = (await res.json()) as { error?: { message?: string } };
          message = j.error?.message ?? message;
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
      await onChanged();
      toast.success("Audio uploaded to draft.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Audio upload failed.");
    } finally {
      setUploadBusy(false);
    }
  }

  async function remove() {
    if (!canPublish) return;
    const ok = await confirm({
      title: `Delete "${item.draft.title_en || item.item_code}"?`,
      destructive: true,
      confirmLabel: "Delete item",
      body: (
        <>
          <p>
            This item disappears from the public library, along with its text, audio and PDF.
          </p>
          <p className="text-muted-foreground">
            Nothing is erased — the record is kept, so a developer can restore it if this was
            a mistake.
          </p>
        </>
      ),
    });
    if (!ok) return;
    try {
      await apiDelete(`/v1/admin/library/items/${item.id}`);
      toast.success("Item deleted.");
      onClose();
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete.");
    }
  }

  return (
    <>
      {confirmDialog}
      <DialogHeader>
        <DialogTitle>
          {item.item_code} — {item.draft.title_en}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <PublishControls
            canPublish={canPublish}
            isPublished={item.is_published}
            hasChanges={hasUnpublishedChanges(item)}
            onPublish={async () => {
              await apiPost(`/v1/admin/library/items/${item.id}/publish`, {});
              await onChanged();
              toast.success("Published.");
            }}
            onUnpublish={async () => {
              await apiPost(`/v1/admin/library/items/${item.id}/unpublish`, {});
              await onChanged();
              toast.success("Unpublished.");
            }}
          />
          {canPublish ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void remove()}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Delete
            </Button>
          ) : null}
        </div>

        <Tabs value={lang} onValueChange={(v) => setLang(v as typeof lang)}>
          <TabsList>
            <TabsTrigger value="en">EN</TabsTrigger>
            <TabsTrigger value="hi">HI</TabsTrigger>
            <TabsTrigger value="gu">GU</TabsTrigger>
          </TabsList>
          <TabsContent value="en" className="space-y-3">
            <FormRow label="Title">
              <Input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
            </FormRow>
            <FormRow label="Tarj">
              <div className="space-y-1">
                <Input
                  value={tarjEn}
                  maxLength={TARJ_MAX_LEN}
                  onChange={(e) => setTarjEn(e.target.value)}
                  placeholder="Tune it is sung to"
                />
                <p className="text-xs text-muted-foreground">
                  The melody this is sung to — another stavan, or a well-known song.
                  Optional, one line, shown under the title.
                </p>
              </div>
            </FormRow>
            <FormRow label="Text">
              <RestrictedHtmlEditor value={textEn} onChange={setTextEn} placeholder="Content…" />
            </FormRow>
          </TabsContent>
          <TabsContent value="hi" className="space-y-3">
            <FormRow label="Title">
              <Input
                className="field-devanagari"
                value={titleHi}
                onChange={(e) => setTitleHi(e.target.value)}
              />
            </FormRow>
            <FormRow label="Tarj">
              <Input
                className="field-devanagari"
                value={tarjHi}
                maxLength={TARJ_MAX_LEN}
                onChange={(e) => setTarjHi(e.target.value)}
                placeholder="जिस तर्ज़ पर गाया जाता है"
              />
            </FormRow>
            <FormRow label="Text">
              <RestrictedHtmlEditor
                value={textHi}
                onChange={setTextHi}
                bodyClassName="field-devanagari"
              />
            </FormRow>
          </TabsContent>
          <TabsContent value="gu" className="space-y-3">
            <FormRow label="Title">
              <Input value={titleGu} onChange={(e) => setTitleGu(e.target.value)} />
            </FormRow>
            <FormRow label="Text">
              <RestrictedHtmlEditor value={textGu} onChange={setTextGu} />
            </FormRow>
          </TabsContent>
        </Tabs>

        <FormRow label="YouTube URL">
          <Input value={youtube} onChange={(e) => setYoutube(e.target.value)} />
        </FormRow>

        <FormRow label="External link">
          <div className="space-y-1">
            <Input
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder="https://…"
            />
            <p className="text-xs text-muted-foreground">
              A document hosted elsewhere — opens in the reader&apos;s browser. Documents
              only: YouTube and Vimeo links belong in the video field and are rejected
              here.
            </p>
          </div>
        </FormRow>

        <FormRow label="PDF">
          <div className="space-y-1">
            {item.draft.pdf_url ? (
              <div className="flex items-center gap-2">
                <p className="truncate text-xs text-muted-foreground">
                  {formatBytes(item.draft.pdf_size_bytes ?? 0)}
                  {item.draft.pdf_page_count
                    ? ` · ${item.draft.pdf_page_count} pages`
                    : " · counting pages…"}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pdfBusy}
                  onClick={() => void removePdf()}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No draft PDF yet.</p>
            )}
            <Input
              type="file"
              accept="application/pdf,.pdf"
              disabled={pdfBusy}
              onChange={(e) => void uploadPdf(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">PDF only, up to 100MB.</p>
          </div>
        </FormRow>

        <FormRow label="Audio (MP3)">
          <div className="space-y-1">
            {item.draft.audio_url ? (
              <div className="space-y-1">
                {/* A truncated signed URL told an editor nothing they could
                    check. Duration and size were already on the DTO, and the
                    only way to be sure the right recording is attached is to
                    hear it. */}
                <audio
                  controls
                  preload="metadata"
                  src={item.draft.audio_url}
                  className="h-9 w-full"
                />
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(item.draft.audio_size_bytes ?? 0)}
                    {item.draft.audio_duration_sec
                      ? ` · ${formatDuration(item.draft.audio_duration_sec)}`
                      : ""}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadBusy}
                    onClick={() => void removeAudio()}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No draft audio yet.</p>
            )}
            <Input
              type="file"
              accept="audio/mpeg,.mp3"
              disabled={uploadBusy}
              onChange={(e) => void uploadAudio(e.target.files?.[0] ?? null)}
            />
          </div>
        </FormRow>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onRequestClose ?? onClose}>
          Close
        </Button>
        <Button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          Save draft
        </Button>
      </DialogFooter>
    </>
  );
}
