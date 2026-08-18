import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { apiDelete, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast-jp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { PublishControls } from "./PublishControls";
import { DragReorderList } from "./DragReorderList";
import { describeContents, useConfirm } from "@/components/admin/use-confirm";
import { hasUnpublishedChanges } from "./library-admin-types";
import type { LibraryAdminSection, LibrarySectionType } from "./library-admin-types";

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
  onChanged: () => Promise<void>;
}

export function LibrarySectionsPanel({ sections, canPublish, onChanged }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editSection, setEditSection] = useState<LibraryAdminSection | null>(null);
  const [subParent, setSubParent] = useState<LibraryAdminSection | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  async function reorderSections(ids: string[]) {
    try {
      await apiPost("/v1/admin/library/sections/reorder", { ids });
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not reorder sections.");
    }
  }

  async function reorderSubs(sectionId: string, ids: string[]) {
    try {
      await apiPost(`/v1/admin/library/sections/${sectionId}/subsections/reorder`, { ids });
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not reorder subsections.");
    }
  }

  async function publish(id: string, kind: "section" | "subsection", publish: boolean) {
    setBusyId(id);
    try {
      const base =
        kind === "section"
          ? `/v1/admin/library/sections/${id}`
          : `/v1/admin/library/subsections/${id}`;
      await apiPost(`${base}/${publish ? "publish" : "unpublish"}`, {});
      await onChanged();
      toast.success(publish ? "Published." : "Unpublished.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Publish action failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function softDelete(
    path: string,
    what: { kind: string; name: string; contains: string | null },
  ) {
    if (!canPublish) return;
    const ok = await confirm({
      title: `Delete "${what.name}"?`,
      destructive: true,
      confirmLabel: `Delete ${what.kind}`,
      body: (
        <>
          <p>
            This {what.kind} disappears from the public library and from this tree
            {what.contains ? `, along with the ${what.contains} inside it` : ""}.
          </p>
          <p className="text-muted-foreground">
            Nothing is erased — the records are kept, so a developer can restore this if it
            was a mistake.
          </p>
        </>
      ),
    });
    if (!ok) return;
    try {
      await apiDelete(path);
      await onChanged();
      toast.success("Deleted.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete.");
    }
  }

  return (
    <div className="space-y-4">
      {confirmDialog}
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1 h-4 w-4" />
              Add section
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <SectionForm
              title="New section"
              onCancel={() => setCreateOpen(false)}
              onSubmit={async (body) => {
                await apiPost("/v1/admin/library/sections", body);
                setCreateOpen(false);
                await onChanged();
                toast.success("Section created as draft.");
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sections yet.</p>
      ) : (
        <DragReorderList
          items={sections}
          labelFor={(s) => s.draft.name_en}
          onReorder={reorderSections}
          renderRow={(s, handle) => {
            const open = !!expanded[s.id];
            return (
              <div className="rounded-md border border-border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {handle}
                  <button
                    type="button"
                    className="text-muted-foreground"
                    onClick={() => setExpanded((e) => ({ ...e, [s.id]: !open }))}
                  >
                    {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{s.draft.name_en}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.key} · {s.draft.type} · {s.is_published ? "published" : "draft"}
                    </div>
                  </div>
                  <PublishControls
                    canPublish={canPublish}
                    isPublished={s.is_published}
                    hasChanges={hasUnpublishedChanges(s)}
                    busy={busyId === s.id}
                    onPublish={() => void publish(s.id, "section", true)}
                    onUnpublish={() => void publish(s.id, "section", false)}
                  />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditSection(s)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {canPublish ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void softDelete(`/v1/admin/library/sections/${s.id}`, {
                          kind: "section",
                          name: s.draft.name_en,
                          contains: describeContents([
                            [s.subsections.length, "subsection", "subsections"],
                            [
                              s.items.length +
                                s.subsections.reduce((n, sub) => n + sub.items.length, 0),
                              "item",
                              "items",
                            ],
                          ]),
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>

                {open ? (
                  <div className="mt-3 space-y-3 border-t border-border pt-3 pl-6">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Subsections
                      </p>
                      <Button type="button" variant="outline" size="sm" onClick={() => setSubParent(s)}>
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Add subsection
                      </Button>
                    </div>
                    {s.subsections.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No subsections.</p>
                    ) : (
                      <DragReorderList
                        items={s.subsections}
                        labelFor={(sub) => sub.draft.name_en}
                        onReorder={(ids) => void reorderSubs(s.id, ids)}
                        renderRow={(sub, subHandle) => (
                          <div className="flex flex-wrap items-center gap-2 rounded border border-border/60 px-2 py-2">
                            {subHandle}
                            <span className="flex-1 text-sm">{sub.draft.name_en}</span>
                            <span className="text-xs text-muted-foreground">
                              {sub.is_published ? "published" : "draft"}
                            </span>
                            <PublishControls
                              canPublish={canPublish}
                              isPublished={sub.is_published}
                              hasChanges={hasUnpublishedChanges(sub)}
                              busy={busyId === sub.id}
                              onPublish={() => void publish(sub.id, "subsection", true)}
                              onUnpublish={() => void publish(sub.id, "subsection", false)}
                            />
                            {canPublish ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  void softDelete(
                                    `/v1/admin/library/subsections/${sub.id}`,
                                    {
                                      kind: "subsection",
                                      name: sub.draft.name_en,
                                      contains: describeContents([
                                        [sub.items.length, "item", "items"],
                                      ]),
                                    },
                                  )
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            ) : null}
                          </div>
                        )}
                      />
                    )}
                  </div>
                ) : null}
              </div>
            );
          }}
        />
      )}

      <Dialog open={!!editSection} onOpenChange={(o) => !o && setEditSection(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {editSection ? (
            <SectionForm
              title="Edit section"
              initial={editSection}
              onCancel={() => setEditSection(null)}
              onSubmit={async (body) => {
                await apiPatch(`/v1/admin/library/sections/${editSection.id}`, body);
                setEditSection(null);
                await onChanged();
                toast.success("Section draft updated.");
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!subParent} onOpenChange={(o) => !o && setSubParent(null)}>
        <DialogContent>
          {subParent ? (
            <SubsectionForm
              onCancel={() => setSubParent(null)}
              onSubmit={async (body) => {
                await apiPost(`/v1/admin/library/sections/${subParent.id}/subsections`, body);
                setSubParent(null);
                await onChanged();
                toast.success("Subsection created.");
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionForm({
  title,
  initial,
  onCancel,
  onSubmit,
}: {
  title: string;
  initial?: LibraryAdminSection;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [key, setKey] = useState(initial?.key ?? "");
  const [nameEn, setNameEn] = useState(initial?.draft.name_en ?? "");
  const [nameHi, setNameHi] = useState(initial?.draft.name_hi ?? "");
  const [nameGu, setNameGu] = useState(initial?.draft.name_gu ?? "");
  const [type, setType] = useState<LibrarySectionType>(initial?.draft.type ?? "item_list");
  const [deeplink, setDeeplink] = useState(initial?.draft.deeplink_target ?? "");
  const [iconUrl, setIconUrl] = useState(initial?.draft.icon_url ?? "");
  const [requiresLogin, setRequiresLogin] = useState(initial?.draft.requires_login ?? false);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!nameEn.trim()) {
      toast.error("English name is required.");
      return;
    }
    if (!initial && !key.trim()) {
      toast.error("Section key is required.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        ...(initial ? {} : { key: key.trim() }),
        name_en: nameEn.trim(),
        name_hi: nameHi.trim() || null,
        name_gu: nameGu.trim() || null,
        type,
        deeplink_target: type === "deeplink" ? deeplink.trim() || null : null,
        icon_url: iconUrl.trim() || null,
        requires_login: requiresLogin,
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save section.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-2">
        {!initial ? (
          <FormRow label="Key">
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="stotras" />
          </FormRow>
        ) : null}
        <FormRow label="Name (EN)">
          <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </FormRow>
        <FormRow label="Name (HI)">
          <Input
            className="field-devanagari"
            value={nameHi}
            onChange={(e) => setNameHi(e.target.value)}
          />
        </FormRow>
        <FormRow label="Name (GU)">
          <Input value={nameGu} onChange={(e) => setNameGu(e.target.value)} />
        </FormRow>
        <FormRow label="Type">
          <Select value={type} onValueChange={(v) => setType(v as LibrarySectionType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="item_list">Item list</SelectItem>
              <SelectItem value="deeplink">Deeplink</SelectItem>
              <SelectItem value="panchang">Panchang</SelectItem>
              <SelectItem value="granth">Granth</SelectItem>
            </SelectContent>
          </Select>
        </FormRow>
        {type === "deeplink" ? (
          <FormRow label="Deeplink target">
            <Input value={deeplink} onChange={(e) => setDeeplink(e.target.value)} />
          </FormRow>
        ) : null}
        <FormRow label="Icon URL (optional)">
          <Input value={iconUrl} onChange={(e) => setIconUrl(e.target.value)} />
        </FormRow>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={requiresLogin} onCheckedChange={(c) => setRequiresLogin(!!c)} />
          Requires login
        </label>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

function SubsectionForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [nameEn, setNameEn] = useState("");
  const [nameHi, setNameHi] = useState("");
  const [nameGu, setNameGu] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!nameEn.trim()) {
      toast.error("English name is required.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        name_en: nameEn.trim(),
        name_hi: nameHi.trim() || null,
        name_gu: nameGu.trim() || null,
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save subsection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New subsection</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-2">
        <FormRow label="Name (EN)">
          <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </FormRow>
        <FormRow label="Name (HI)">
          <Input
            className="field-devanagari"
            value={nameHi}
            onChange={(e) => setNameHi(e.target.value)}
          />
        </FormRow>
        <FormRow label="Name (GU)">
          <Input value={nameGu} onChange={(e) => setNameGu(e.target.value)} />
        </FormRow>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
