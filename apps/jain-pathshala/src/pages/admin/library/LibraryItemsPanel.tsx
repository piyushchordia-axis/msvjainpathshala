import { useMemo, useState } from "react";
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
import { PublishControls } from "./PublishControls";
import { RestrictedHtmlEditor } from "./RestrictedHtmlEditor";
import {
  flattenLibraryItems,
  type LibraryAdminItem,
  type LibraryAdminSection,
} from "./library-admin-types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

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
  const [q, setQ] = useState("");
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [pubFilter, setPubFilter] = useState<"all" | "published" | "draft">("all");
  const [createOpen, setCreateOpen] = useState(false);
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

  return (
    <div className="space-y-4">
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
          if (!o) setEditItem(null);
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          {editItem ? (
            <ItemEditor
              key={editItem.id}
              item={editItem}
              canPublish={canPublish}
              onClose={() => setEditItem(null)}
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
          <Input value={titleHi} onChange={(e) => setTitleHi(e.target.value)} />
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
}: {
  item: LibraryAdminItem;
  canPublish: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [lang, setLang] = useState<"en" | "hi" | "gu">("en");
  const [titleEn, setTitleEn] = useState(item.draft.title_en);
  const [titleHi, setTitleHi] = useState(item.draft.title_hi ?? "");
  const [titleGu, setTitleGu] = useState(item.draft.title_gu ?? "");
  const [textEn, setTextEn] = useState(item.draft.text_content_en ?? "");
  const [textHi, setTextHi] = useState(item.draft.text_content_hi ?? "");
  const [textGu, setTextGu] = useState(item.draft.text_content_gu ?? "");
  const [youtube, setYoutube] = useState(item.draft.youtube_url ?? "");
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);

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
      });
      await onChanged();
      toast.success("Draft saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save item.");
    } finally {
      setBusy(false);
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
    if (!window.confirm("Soft-delete this item?")) return;
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
            <FormRow label="Text">
              <RestrictedHtmlEditor value={textEn} onChange={setTextEn} placeholder="Content…" />
            </FormRow>
          </TabsContent>
          <TabsContent value="hi" className="space-y-3">
            <FormRow label="Title">
              <Input value={titleHi} onChange={(e) => setTitleHi(e.target.value)} />
            </FormRow>
            <FormRow label="Text">
              <RestrictedHtmlEditor value={textHi} onChange={setTextHi} />
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

        <FormRow label="Audio (MP3)">
          <div className="space-y-1">
            {item.draft.audio_url ? (
              <p className="truncate text-xs text-muted-foreground">{item.draft.audio_url}</p>
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
        <Button type="button" variant="outline" onClick={onClose}>
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
